"use server";

import { sql, db } from "@/lib/db";
import { v3Tickets } from "@/lib/db-schema";
import { eq, and, desc, sql as dsql } from "drizzle-orm";
import { getCurrentUser, canReport, canApproveLevel1, canApproveLevel2, canQuickRelease, canScan } from "@/lib/auth";
import { fetchWaybillByCode, checkSkuBelong, flagWaybill, unflagWaybill } from "@/lib/v2-client";
import { evaluateScan } from "@/lib/qc-engine";
import { determineLevel, getThresholdL2, computeApprovalDue, computeQcHoldDue, getResubmitLimit } from "@/lib/approval-engine";
import { canTransition, nextStatusOnApprove, nextStatusOnTimeout, isReviewing } from "@/lib/state-machine";
import { setConfig, getAllConfig } from "@/lib/config";
import { EXCEPTION_ACTION_MAP, EXCEPTION_META, type ExceptionType, type TicketFilter } from "@/types";

function genTicketNo(prefix: string): string {
  return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

// ==================== 异常上报 ====================
export async function createTicket(input: {
  waybillCode: string;
  exceptionType: ExceptionType;
  description: string;
  amount: number;
}): Promise<{ ticketId: string; ticketNo: string; waybillSource: string }> {
  const user = await getCurrentUser();
  if (!canReport(user)) throw new Error("无异常上报权限");

  const { waybillCode, exceptionType, description, amount } = input;

  // 实时校验 V2 运单存在（不允许仅凭本地快照）
  const result = await fetchWaybillByCode(waybillCode);
  if (!result.data || !result.data.exists) {
    throw new Error(`运单 ${waybillCode} 不存在（V2 实时校验失败${result.error ? "：" + result.error : ""}）`);
  }
  if (result.source === "fallback") {
    throw new Error("V2 服务不可用，且本地无该运单快照，发起上报必须实时校验，请稍后重试");
  }

  // 同类型未关闭工单检查
  const existing = await sql`
    SELECT id, status, ticket_no FROM v3_tickets
    WHERE waybill_code=${waybillCode} AND exception_type=${exceptionType} AND status NOT IN ('done','closed')
    LIMIT 1
  `;
  if (existing.length > 0) {
    throw new Error(`该运单已存在同类型未关闭工单 ${existing[0].ticket_no}（状态：${existing[0].status}）`);
  }

  const level = await determineLevel(amount);
  const ticketNo = genTicketNo("TK");
  const dueAt = await computeApprovalDue(new Date());

  const rows = await sql`
    INSERT INTO v3_tickets (ticket_no, waybill_code, exception_type, exception_source, description, reported_by_id, reported_by_name, reported_at, status, current_level, amount, due_at, last_activity_at)
    VALUES (${ticketNo}, ${waybillCode}, ${exceptionType}, 'manual', ${description}, ${user.userId}, ${user.userName}, now(), 'pending', ${level}, ${amount.toString()}, ${dueAt}, now())
    RETURNING id
  `;
  const ticketId = rows[0].id;

  // 回写 V2 异常标记（失败不阻塞）
  await flagWaybill(waybillCode, ticketId, ticketNo, `异常上报：${EXCEPTION_META[exceptionType].label}`);

  return { ticketId, ticketNo, waybillSource: result.source };
}

// ==================== 扫描品控 ====================
export async function scanWaybill(input: {
  waybillCode: string;
  skuCode: string;
  batchNo: string;
  actualQty: number;
  damageLevel: number;
  hasLabelError: boolean;
  specDeviationPct: number;
  batchAnomaly: boolean;
}): Promise<{ scanId: string; result: "pass" | "fail"; reason: string; ticketNo?: string; duplicated?: boolean }> {
  const user = await getCurrentUser();
  if (!canScan(user)) throw new Error("无扫描录入权限");

  const { waybillCode, skuCode, batchNo, actualQty, damageLevel, hasLabelError, specDeviationPct, batchAnomaly } = input;

  // 实时校验 SKU 归属 V2
  const belongRes = await checkSkuBelong(waybillCode, skuCode);
  if (belongRes.error) throw new Error(`V2 接口校验失败：${belongRes.error}`);
  if (!belongRes.belongs) throw new Error(`SKU ${skuCode} 不归属于运单 ${waybillCode}，禁止扫描`);

  // 拿 expectedQty（用于数量差异判定，允许降级快照）
  const wbResult = await fetchWaybillByCode(waybillCode, { allowCache: true });
  let expectedQty = actualQty;
  if (wbResult.data?.skus) {
    const sku = wbResult.data.skus.find((s) => s.skuCode === skuCode);
    if (sku) expectedQty = Number(sku.skuQuantity) || 0;
  }

  // 幂等：同 waybill+sku+batch 有未关闭品控工单 → 追加扫描记录，不建工单
  const existingTicket = await sql`
    SELECT t.id, t.ticket_no FROM v3_tickets t
    JOIN v3_scan_records s ON s.ticket_id = t.id
    WHERE t.waybill_code=${waybillCode} AND t.exception_source='scan' AND t.status NOT IN ('done','closed')
    AND s.sku_code=${skuCode} AND s.batch_no=${batchNo}
    LIMIT 1
  `;

  const evalResult = await evaluateScan({ waybillCode, skuCode, batchNo, actualQty, expectedQty, damageLevel, hasLabelError, specDeviationPct, batchAnomaly });

  if (existingTicket.length > 0) {
    const scanRows = await sql`
      INSERT INTO v3_scan_records (waybill_code, sku_code, batch_no, scanned_by_id, scanned_by_name, qc_result, qc_rule_id, qc_reason, batch_status, ticket_id, note)
      VALUES (${waybillCode}, ${skuCode}, ${batchNo}, ${user.userId}, ${user.userName}, ${evalResult.result}, ${evalResult.ruleId ?? null}, ${evalResult.reason}, ${evalResult.result === "fail" ? "qc_hold" : "qc_passed"}, ${existingTicket[0].id}, '幂等追加：该批次已存在未关闭品控工单')
      RETURNING id
    `;
    return { scanId: scanRows[0].id, result: evalResult.result, reason: `该批次已存在未关闭品控工单 ${existingTicket[0].ticket_no}，已追加扫描记录，未重复建单`, duplicated: true };
  }

  // 正常路径：插入扫描记录
  const scanRows = await sql`
    INSERT INTO v3_scan_records (waybill_code, sku_code, batch_no, scanned_by_id, scanned_by_name, qc_result, qc_rule_id, qc_reason, batch_status)
    VALUES (${waybillCode}, ${skuCode}, ${batchNo}, ${user.userId}, ${user.userName}, ${evalResult.result}, ${evalResult.ruleId ?? null}, ${evalResult.reason}, ${evalResult.result === "fail" ? "qc_hold" : "qc_passed"})
    RETURNING id
  `;
  const scanId = scanRows[0].id;

  if (evalResult.result === "fail") {
    // 锁定批次库存
    await sql`
      INSERT INTO v3_inventory (sku_code, batch_no, quantity, locked, updated_at)
      VALUES (${skuCode}, ${batchNo}, ${actualQty}, true, now())
      ON CONFLICT DO NOTHING
    `;
    await sql`UPDATE v3_inventory SET locked=true, updated_at=now() WHERE sku_code=${skuCode} AND batch_no=${batchNo}`;

    // 创建品控工单（默认进二级审批，因涉及追偿）
    const level = evalResult.autoApprovalLevel ?? 2;
    const ticketNo = genTicketNo("QC");
    const dueAt = await computeQcHoldDue(new Date());
    const amount = actualQty * 100;
    const ticketRows = await sql`
      INSERT INTO v3_tickets (ticket_no, waybill_code, exception_type, exception_source, description, reported_by_id, reported_by_name, reported_at, status, current_level, amount, due_at, qc_batch_id, last_activity_at)
      VALUES (${ticketNo}, ${waybillCode}, ${evalResult.exceptionSubType ?? "quantity_diff"}, 'scan', ${evalResult.reason}, ${user.userId}, ${user.userName}, now(), 'level2_reviewing', ${level}, ${amount.toString()}, ${dueAt}, ${batchNo}, now())
      RETURNING id
    `;
    const ticketId = ticketRows[0].id;

    await sql`UPDATE v3_scan_records SET ticket_id=${ticketId} WHERE id=${scanId}`;
    await sql`UPDATE v3_inventory SET locked_by_ticket_id=${ticketId} WHERE sku_code=${skuCode} AND batch_no=${batchNo}`;
    await flagWaybill(waybillCode, ticketId, ticketNo, `品控异常：${evalResult.reason}`);

    return { scanId, result: "fail", reason: evalResult.reason, ticketNo };
  }

  return { scanId, result: "pass", reason: evalResult.reason };
}

// ==================== 审批通过 ====================
export async function approveTicket(input: {
  ticketId: string;
  comment: string;
  requestId: string;
}): Promise<{ success: boolean; message: string; newStatus?: string }> {
  const user = await getCurrentUser();
  const { ticketId, comment, requestId } = input;

  // 幂等：同一 requestId 已处理则跳过
  const existRec = await sql`SELECT id FROM v3_approval_records WHERE request_id=${requestId} LIMIT 1`;
  if (existRec.length > 0) return { success: false, message: "该审批操作已处理（幂等保护）" };

  const tickets = await sql`SELECT * FROM v3_tickets WHERE id=${ticketId} LIMIT 1`;
  if (tickets.length === 0) throw new Error("工单不存在");
  const ticket = tickets[0] as { id: string; status: string; current_level: number; amount: string; version: number; reported_by_id: string; waybill_code: string; exception_type: string; exception_source: string };

  if (!isReviewing(ticket.status as never)) throw new Error(`工单当前状态 ${ticket.status} 不可审批`);

  // 权限 + 自批自核禁止（后端校验，非前端隐藏）
  if (ticket.current_level === 1 && !canApproveLevel1(user)) throw new Error("您无一级审批权限");
  if (ticket.current_level === 2 && !canApproveLevel2(user)) throw new Error("您无二级审批权限");
  if (ticket.reported_by_id === user.userId) throw new Error("不能审批自己提交的工单");

  // 状态机校验
  const threshold = await getThresholdL2();
  const nextStatus = nextStatusOnApprove(ticket.status as never, Number(ticket.amount), threshold);
  if (!canTransition(ticket.status as never, nextStatus)) throw new Error(`状态流转非法：${ticket.status} → ${nextStatus}`);

  // 乐观锁：version 不符 → 并发冲突
  const updated = await sql`
    UPDATE v3_tickets SET status=${nextStatus}, version=version+1, last_activity_at=now(), updated_at=now()
    WHERE id=${ticketId} AND version=${ticket.version}
    RETURNING id, version
  `;
  if (updated.length === 0) throw new Error("该工单已被他人处理，请刷新后重试");

  // 写审批记录
  const approvalRows = await sql`
    INSERT INTO v3_approval_records (ticket_id, approver_id, approver_name, level, decision, comment, request_id)
    VALUES (${ticketId}, ${user.userId}, ${user.userName}, ${ticket.current_level}, 'approve', ${comment}, ${requestId})
    RETURNING id
  `;
  const approvalId = approvalRows[0].id;

  // 进入执行中 → 触发执行联动（赔付+库存+批次解锁）
  if (nextStatus === "executing") {
    await executeActions(ticketId, approvalId, ticket);
    await sql`UPDATE v3_tickets SET status='done', closed_at=now(), version=version+1, updated_at=now() WHERE id=${ticketId}`;
    await unflagWaybill(ticket.waybill_code);
    return { success: true, message: "审批通过，已执行完成", newStatus: "done" };
  }

  return { success: true, message: "审批通过，进入下一级", newStatus: nextStatus };
}

// ==================== 审批拒绝 ====================
export async function rejectTicket(input: {
  ticketId: string;
  comment: string;
  requestId: string;
}): Promise<{ success: boolean; message: string; newStatus?: string }> {
  const user = await getCurrentUser();
  const { ticketId, comment, requestId } = input;

  const existRec = await sql`SELECT id FROM v3_approval_records WHERE request_id=${requestId} LIMIT 1`;
  if (existRec.length > 0) return { success: false, message: "该操作已处理（幂等保护）" };

  const tickets = await sql`SELECT * FROM v3_tickets WHERE id=${ticketId} LIMIT 1`;
  if (tickets.length === 0) throw new Error("工单不存在");
  const ticket = tickets[0] as { id: string; status: string; current_level: number; version: number; reported_by_id: string; resubmit_count: number; max_resubmit: number; waybill_code: string; exception_source: string };

  if (!isReviewing(ticket.status as never)) throw new Error(`工单状态 ${ticket.status} 不可审批`);
  if (ticket.current_level === 1 && !canApproveLevel1(user)) throw new Error("无一级审批权限");
  if (ticket.current_level === 2 && !canApproveLevel2(user)) throw new Error("无二级审批权限");
  if (ticket.reported_by_id === user.userId) throw new Error("不能审批自己提交的工单");

  const limit = await getResubmitLimit();
  const newCount = ticket.resubmit_count + 1;
  const nextStatus = newCount > limit ? "closed" : "rejected";

  const updated = await sql`
    UPDATE v3_tickets SET status=${nextStatus}, resubmit_count=${newCount}, version=version+1, last_activity_at=now(), updated_at=now()
    WHERE id=${ticketId} AND version=${ticket.version}
    RETURNING id
  `;
  if (updated.length === 0) throw new Error("该工单已被他人处理，请刷新后重试");

  await sql`
    INSERT INTO v3_approval_records (ticket_id, approver_id, approver_name, level, decision, comment, request_id)
    VALUES (${ticketId}, ${user.userId}, ${user.userName}, ${ticket.current_level}, 'reject', ${comment}, ${requestId})
  `;

  if (nextStatus === "closed") {
    await unflagWaybill(ticket.waybill_code);
    if (ticket.exception_source === "scan") {
      await sql`UPDATE v3_inventory SET locked=false, locked_by_ticket_id=null WHERE locked_by_ticket_id=${ticketId}`;
      await sql`UPDATE v3_scan_records SET batch_status='released' WHERE ticket_id=${ticketId}`;
    }
  }

  return { success: true, message: nextStatus === "closed" ? "已拒绝并关闭（超重提上限）" : "已拒绝，可重新提交", newStatus: nextStatus };
}

// ==================== 品控主管误判快速放行 ====================
export async function quickRelease(input: { ticketId: string; reason: string; requestId: string }): Promise<{ success: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!canQuickRelease(user)) throw new Error("仅品控主管可操作误判快速放行");

  const { ticketId, reason, requestId } = input;
  const existRec = await sql`SELECT id FROM v3_approval_records WHERE request_id=${requestId} LIMIT 1`;
  if (existRec.length > 0) return { success: false, message: "该操作已处理（幂等保护）" };

  const tickets = await sql`SELECT * FROM v3_tickets WHERE id=${ticketId} LIMIT 1`;
  if (tickets.length === 0) throw new Error("工单不存在");
  const ticket = tickets[0] as { id: string; version: number; status: string; exception_source: string; waybill_code: string };
  if (ticket.exception_source !== "scan") throw new Error("仅品控工单可快速放行");
  if (ticket.status === "done" || ticket.status === "closed") throw new Error("工单已结束");

  const updated = await sql`
    UPDATE v3_tickets SET status='closed', closed_at=now(), version=version+1, last_activity_at=now(), updated_at=now()
    WHERE id=${ticketId} AND version=${ticket.version}
    RETURNING id
  `;
  if (updated.length === 0) throw new Error("该工单已被处理，请刷新后重试");

  // 批次解锁（与工单关闭一致性）
  await sql`UPDATE v3_inventory SET locked=false, locked_by_ticket_id=null WHERE locked_by_ticket_id=${ticketId}`;
  await sql`UPDATE v3_scan_records SET batch_status='released', note=${"品控主管误判快速放行：" + reason} WHERE ticket_id=${ticketId}`;

  // 留痕（不允许静默放行）
  await sql`
    INSERT INTO v3_approval_records (ticket_id, approver_id, approver_name, level, decision, comment, request_id)
    VALUES (${ticketId}, ${user.userId}, ${user.userName}, 0, 'quick_release', ${reason}, ${requestId})
  `;
  await unflagWaybill(ticket.waybill_code);

  return { success: true, message: "已快速放行，批次解锁，工单关闭" };
}

// ==================== 重提 ====================
export async function resubmitTicket(ticketId: string): Promise<{ success: boolean; message: string }> {
  const user = await getCurrentUser();
  const tickets = await sql`SELECT * FROM v3_tickets WHERE id=${ticketId} LIMIT 1`;
  if (tickets.length === 0) throw new Error("工单不存在");
  const ticket = tickets[0] as { id: string; status: string; reported_by_id: string };
  if (ticket.status !== "rejected") throw new Error("仅已拒绝工单可重提");
  if (ticket.reported_by_id !== user.userId) throw new Error("仅上报人可重提");

  const dueAt = await computeApprovalDue(new Date());
  await sql`
    UPDATE v3_tickets SET status='pending', current_level=1, due_at=${dueAt}, version=version+1, last_activity_at=now(), updated_at=now()
    WHERE id=${ticketId}
  `;
  return { success: true, message: "已重新提交" };
}

// ==================== 转交（离职兜底） ====================
export async function reassignTicket(input: { ticketId: string; newApproverId: string; reason: string }): Promise<{ success: boolean; message: string }> {
  const user = await getCurrentUser();
  const { ticketId, newApproverId, reason } = input;
  const updated = await sql`
    UPDATE v3_tickets SET assigned_approver_id=${newApproverId}, version=version+1, last_activity_at=now(), updated_at=now()
    WHERE id=${ticketId} AND status IN ('pending','level1_reviewing','level2_reviewing')
    RETURNING id
  `;
  if (updated.length === 0) throw new Error("工单不存在或不在可转交状态");

  await sql`
    INSERT INTO v3_approval_records (ticket_id, approver_id, approver_name, level, decision, comment, request_id)
    VALUES (${ticketId}, ${user.userId}, ${user.userName}, 0, 'reassign', ${"转交给 " + newApproverId + "：" + reason}, ${crypto.randomUUID()})
  `;
  return { success: true, message: "已转交" };
}

// ==================== 执行联动（赔付 + 库存 + 批次解锁，可追溯） ====================
async function executeActions(ticketId: string, approvalId: string, ticket: { exception_type: string; exception_source: string; amount: string }): Promise<void> {
  const action = EXCEPTION_ACTION_MAP[ticket.exception_type as ExceptionType];
  if (!action) return;

  // 1. 生成赔付记录（关联 approvalId，可追溯）
  if (action.compensateDirection !== "none" && Number(ticket.amount) > 0) {
    await sql`
      INSERT INTO v3_compensations (ticket_id, approval_record_id, amount, direction, type, status)
      VALUES (${ticketId}, ${approvalId}, ${ticket.amount}, ${action.compensateDirection}, ${action.compensateType}, 'done')
    `;
  }

  // 2. 库存联动
  if (action.inventoryAction === "return_in") {
    await sql`UPDATE v3_inventory SET quantity=quantity+1, updated_at=now() WHERE sku_code IN (SELECT sku_code FROM v3_scan_records WHERE ticket_id=${ticketId})`;
  } else if (action.inventoryAction === "ship_rollback" || action.inventoryAction === "ship_out" || action.inventoryAction === "scrap") {
    await sql`UPDATE v3_inventory SET locked=false, locked_by_ticket_id=null, quantity=quantity-1, updated_at=now() WHERE locked_by_ticket_id=${ticketId}`;
  }

  // 3. 品控类：批次状态 → released（与工单 done 在调用方同一逻辑块内完成）
  if (ticket.exception_source === "scan") {
    await sql`UPDATE v3_scan_records SET batch_status='released' WHERE ticket_id=${ticketId}`;
  }
}

// ==================== 超时懒触发（进页/列表查询时调用，替代后台 Cron） ====================
export async function triggerTimeoutCheck(): Promise<{ processed: number }> {
  const overdue = await sql`
    SELECT id, status, version, waybill_code, exception_source FROM v3_tickets
    WHERE due_at < now() AND status IN ('pending','level1_reviewing','level2_reviewing')
    LIMIT 50
  `;
  let processed = 0;
  for (const t of overdue as { id: string; status: string; version: number; waybill_code: string; exception_source: string }[]) {
    const next = nextStatusOnTimeout(t.status as never);
    const updated = await sql`
      UPDATE v3_tickets SET status=${next}, version=version+1, last_activity_at=now(), updated_at=now()
      WHERE id=${t.id} AND version=${t.version} AND status=${t.status}
      RETURNING id
    `;
    if (updated.length > 0) {
      processed++;
      await sql`
        INSERT INTO v3_approval_records (ticket_id, approver_id, approver_name, level, decision, comment, request_id)
        VALUES (${t.id}, 'system', '系统超时自动流转', ${t.status === "level2_reviewing" ? 2 : 1}, 'timeout_escalate', ${"超时自动" + (next === "closed" ? "驳回" : "升级")}, ${"timeout-" + t.id + "-" + Date.now()})
      `;
      if (next === "closed") {
        await unflagWaybill(t.waybill_code);
        if (t.exception_source === "scan") {
          await sql`UPDATE v3_inventory SET locked=false, locked_by_ticket_id=null WHERE locked_by_ticket_id=${t.id}`;
          await sql`UPDATE v3_scan_records SET batch_status='released' WHERE ticket_id=${t.id}`;
        }
      }
    }
  }
  return { processed };
}

// ==================== 列表（筛选 + 分页） ====================
export async function getTicketsPage(filter: TicketFilter): Promise<{ rows: unknown[]; total: number; page: number; pageSize: number }> {
  // 进页时顺带触发超时检查（懒触发）
  await triggerTimeoutCheck().catch(() => ({ processed: 0 }));

  const offset = (filter.page - 1) * filter.pageSize;
  const conds = [];
  if (filter.status) conds.push(eq(v3Tickets.status, filter.status));
  if (filter.exceptionType) conds.push(eq(v3Tickets.exceptionType, filter.exceptionType));
  if (filter.waybillCode) conds.push(eq(v3Tickets.waybillCode, filter.waybillCode));
  if (filter.reportedById) conds.push(eq(v3Tickets.reportedById, filter.reportedById));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db.select().from(v3Tickets).where(where).orderBy(desc(v3Tickets.createdAt)).limit(filter.pageSize).offset(offset);
  const totalRows = await db.select({ c: dsql`count(*)` }).from(v3Tickets).where(where);
  return { rows, total: Number((totalRows[0] as { c: unknown }).c) || 0, page: filter.page, pageSize: filter.pageSize };
}

// ==================== 待我审批 ====================
export async function getMyApprovals(): Promise<{ rows: unknown[] }> {
  const user = await getCurrentUser();
  await triggerTimeoutCheck().catch(() => ({ processed: 0 }));
  let level = 0;
  if (canApproveLevel1(user)) level = 1;
  else if (canApproveLevel2(user)) level = 2;
  else return { rows: [] };

  const rows = await sql`
    SELECT * FROM v3_tickets
    WHERE status = ${level === 1 ? "level1_reviewing" : "level2_reviewing"}
      AND current_level = ${level}
      AND reported_by_id != ${user.userId}
    ORDER BY due_at ASC
  `;
  return { rows: rows as unknown[] };
}

// ==================== 工单详情（状态历史 + 审批 + 赔付 + 扫描 + 运单来源） ====================
export async function getTicketDetail(ticketId: string): Promise<{ ticket: unknown; approvals: unknown[]; compensations: unknown[]; scans: unknown[]; waybill: unknown; waybillSource: string }> {
  const tickets = await sql`SELECT * FROM v3_tickets WHERE id=${ticketId} LIMIT 1`;
  if (tickets.length === 0) throw new Error("工单不存在");
  const ticket = tickets[0] as { waybill_code: string };

  const [approvals, compensations, scans] = await Promise.all([
    sql`SELECT * FROM v3_approval_records WHERE ticket_id=${ticketId} ORDER BY created_at ASC`,
    sql`SELECT * FROM v3_compensations WHERE ticket_id=${ticketId} ORDER BY created_at ASC`,
    sql`SELECT * FROM v3_scan_records WHERE ticket_id=${ticketId} ORDER BY created_at ASC`,
  ]);

  // 运单信息（实时拉取 V2，失败降级快照）
  const wbResult = await fetchWaybillByCode(ticket.waybill_code, { allowCache: true });
  return {
    ticket: tickets[0],
    approvals: approvals as unknown[],
    compensations: compensations as unknown[],
    scans: scans as unknown[],
    waybill: wbResult.data,
    waybillSource: wbResult.source,
  };
}

// ==================== 工作台统计 ====================
export async function getDashboardStats(): Promise<{ byStatus: Record<string, number>; total: number; overdue: number; syncSuccessRate: number; syncTotal: number; syncErrorByType: Record<string, number> }> {
  await triggerTimeoutCheck().catch(() => ({ processed: 0 }));
  const statusRows = await sql`SELECT status, count(*)::int AS c FROM v3_tickets GROUP BY status`;
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of statusRows as { status: string; c: number }[]) {
    byStatus[r.status] = r.c;
    total += r.c;
  }
  const overdueRows = await sql`SELECT count(*)::int AS c FROM v3_tickets WHERE due_at < now() AND status IN ('pending','level1_reviewing','level2_reviewing')`;
  const syncRows = await sql`SELECT count(*)::int AS c, count(*) FILTER (WHERE success=true)::int AS ok FROM v3_sync_logs WHERE called_at > now() - interval '24 hours'`;
  const syncTotal = (syncRows[0] as { c: number }).c;
  const syncOk = (syncRows[0] as { ok: number }).ok;
  // 按 error type 聚合（来自 error_message JSON 的 type 字段）
  const errorTypeRows = await sql`
    SELECT (CASE WHEN (error_message::json->>'type') IS NULL OR (error_message::json->>'type') = '' THEN 'unknown' ELSE (error_message::json->>'type') END) AS t, count(*)::int AS c
    FROM v3_sync_logs
    WHERE called_at > now() - interval '24 hours'
    GROUP BY t
    ORDER BY c DESC
  `;
  const syncErrorByType: Record<string, number> = {};
  for (const r of errorTypeRows as { t: string; c: number }[]) {
    syncErrorByType[r.t] = r.c;
  }
  return {
    byStatus,
    total,
    overdue: (overdueRows[0] as { c: number }).c,
    syncSuccessRate: syncTotal > 0 ? Math.round((syncOk / syncTotal) * 100) : 100,
    syncTotal,
    syncErrorByType,
  };
}

// ==================== 接口同步日志 ====================
export async function getSyncLogs(page = 1, pageSize = 30): Promise<{ rows: unknown[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const rows = await sql`SELECT * FROM v3_sync_logs ORDER BY called_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
  const totalRows = await sql`SELECT count(*)::int AS c FROM v3_sync_logs`;
  return { rows: rows as unknown[], total: (totalRows[0] as { c: number }).c };
}

// ==================== 配置管理 ====================
export async function getConfigList() {
  return getAllConfig();
}

export async function updateConfigItem(key: string, value: string, category: string, description?: string): Promise<{ success: boolean }> {
  await setConfig(key, value, category, description);
  return { success: true };
}

// ==================== 品控规则管理 ====================
export async function getQcRules(): Promise<{ rows: unknown[] }> {
  const rows = await sql`SELECT * FROM v3_qc_rules ORDER BY active DESC, created_at DESC`;
  return { rows: rows as unknown[] };
}

export async function saveQcRule(input: { id?: string; name: string; exceptionSubType: string; triggerType: string; triggerCondition: unknown; severity: string; autoCreateTicket: boolean; autoApprovalLevel: number; active: boolean }): Promise<{ success: boolean }> {
  const cond = JSON.stringify(input.triggerCondition);
  if (input.id) {
    await sql`
      UPDATE v3_qc_rules SET name=${input.name}, exception_sub_type=${input.exceptionSubType}, trigger_type=${input.triggerType}, trigger_condition=${cond}::jsonb, severity=${input.severity}, auto_create_ticket=${input.autoCreateTicket}, auto_approval_level=${input.autoApprovalLevel}, active=${input.active}, updated_at=now()
      WHERE id=${input.id}
    `;
  } else {
    await sql`
      INSERT INTO v3_qc_rules (name, exception_sub_type, trigger_type, trigger_condition, severity, auto_create_ticket, auto_approval_level, active)
      VALUES (${input.name}, ${input.exceptionSubType}, ${input.triggerType}, ${cond}::jsonb, ${input.severity}, ${input.autoCreateTicket}, ${input.autoApprovalLevel}, ${input.active})
    `;
  }
  return { success: true };
}

export async function toggleQcRule(id: string, active: boolean): Promise<{ success: boolean }> {
  await sql`UPDATE v3_qc_rules SET active=${active}, updated_at=now() WHERE id=${id}`;
  return { success: true };
}

// ==================== 库存查询 ====================
export async function getInventoryList(): Promise<{ rows: unknown[] }> {
  const rows = await sql`SELECT * FROM v3_inventory ORDER BY locked DESC, updated_at DESC LIMIT 100`;
  return { rows: rows as unknown[] };
}

// ==================== 运单实时校验（上报页用，展示运单 + 来源标注） ====================
export async function getWaybillForReport(code: string) {
  const result = await fetchWaybillByCode(code);
  return result;
}

