/**
 * V3 种子数据：配置项 + 品控规则 + 用户 + 200 条模拟工单（覆盖规模化场景）
 * 运行：npm run db:seed
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import {
  CONFIG_DEFAULTS, EXCEPTION_META, EXCEPTION_ACTION_MAP,
  type ExceptionType, type TicketStatus,
} from "../src/types";

const sql = neon(process.env.DATABASE_URL!);

const CONFIG_DESCRIPTIONS: Record<string, string> = {
  approval_threshold_l2: "二级审批金额阈值（元），金额≥此值进入二级审批",
  approval_timeout_minutes: "审批超时分钟数，超时自动升级/驳回",
  qc_hold_timeout_minutes: "品控暂扣超时分钟数（独立于审批超时，应远短于审批超时）",
  resubmit_limit: "拒绝后允许重新提交次数上限",
  v2_sync_mode: "V2 数据同步模式：realtime=实时拉取",
  v2_api_timeout_ms: "V2 接口调用超时（毫秒）",
  v2_api_retry: "V2 接口失败重试次数",
};

const QC_TYPES = ["quantity_diff", "appearance_damage", "spec_mismatch", "label_error", "batch_anomaly"] as ExceptionType[];
const LOGISTICS_TYPES = ["lost", "damaged", "rejected", "timeout", "address_error"] as ExceptionType[];

const REPORTERS = [
  { id: "u-operator-01", name: "操作员甲" },
  { id: "u-qcmanager-01", name: "品控主管丁" },
];
const APPROVERS = [
  { id: "u-approver1-01", name: "审批人乙" },
  { id: "u-approver2-01", name: "审批人丙" },
];

// 状态分布（总 200），覆盖各状态/类型/来源
const STATUS_PLAN: { status: TicketStatus; count: number }[] = [
  { status: "pending", count: 30 },
  { status: "level1_reviewing", count: 40 },
  { status: "level2_reviewing", count: 30 },
  { status: "executing", count: 10 },
  { status: "done", count: 50 },
  { status: "rejected", count: 20 },
  { status: "closed", count: 20 },
];

function genNo(prefix: string, i: number): string {
  return `${prefix}${(10000 + i).toString(36).toUpperCase()}`;
}

async function main() {
  console.log("正在初始化配置项...");
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    const category = key.includes("threshold") ? "approval" : key.includes("timeout") ? "timeout" : "sync";
    const desc = CONFIG_DESCRIPTIONS[key] || "";
    await sql`
      INSERT INTO v3_config (key, value, category, description, updated_at)
      VALUES (${key}, ${value}, ${category}, ${desc}, now())
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, category=EXCLUDED.category, description=EXCLUDED.description
    `;
  }

  console.log("正在初始化品控规则...");
  const qcRules = [
    { name: "数量差异>5%", sub: "quantity_diff", type: "quantity_diff", cond: { threshold_pct: 5 }, severity: "high", level: 2 },
    { name: "破损等级≥3", sub: "appearance_damage", type: "damage_level", cond: { min_level: 3 }, severity: "medium", level: 2 },
    { name: "规格偏差>10%", sub: "spec_mismatch", type: "spec_deviation", cond: { threshold_pct: 10 }, severity: "medium", level: 2 },
    { name: "标签错误", sub: "label_error", type: "label_error", cond: {}, severity: "low", level: 1 },
    { name: "批次异常", sub: "batch_anomaly", type: "batch_anomaly", cond: {}, severity: "high", level: 2 },
  ];
  for (const r of qcRules) {
    await sql`
      INSERT INTO v3_qc_rules (name, exception_sub_type, trigger_type, trigger_condition, severity, auto_create_ticket, auto_approval_level, active)
      VALUES (${r.name}, ${r.sub}, ${r.type}, ${JSON.stringify(r.cond)}::jsonb, ${r.severity}, true, ${r.level}, true)
    `;
  }

  console.log("正在初始化用户...");
  const users = [
    { id: "u-operator-01", name: "操作员甲", role: "operator" },
    { id: "u-approver1-01", name: "审批人乙", role: "approver1" },
    { id: "u-approver2-01", name: "审批人丙", role: "approver2" },
    { id: "u-qcmanager-01", name: "品控主管丁", role: "qc_manager" },
  ];
  for (const u of users) {
    await sql`
      INSERT INTO v3_users (id, name, role, active)
      VALUES (${u.id}, ${u.name}, ${u.role}, true)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, active=true
    `;
  }

  console.log("正在清空旧工单数据...");
  await sql`DELETE FROM v3_scan_records`;
  await sql`DELETE FROM v3_tickets`; // cascade 删 compensations + approval_records

  console.log("正在生成 200 条工单...");
  const now = Date.now();
  let idx = 0;

  for (const plan of STATUS_PLAN) {
    for (let i = 0; i < plan.count; i++) {
      idx++;
      const isScan = idx % 3 === 0; // ~1/3 品控类
      const exType = isScan ? QC_TYPES[idx % QC_TYPES.length] : LOGISTICS_TYPES[idx % LOGISTICS_TYPES.length];
      const reporter = isScan ? REPORTERS[1] : REPORTERS[0];
      const amount = 50 + ((idx * 37) % 1950);
      const level = amount >= 500 ? 2 : 1;
      const reportedAt = new Date(now - (idx % 168) * 60 * 60 * 1000); // 最近 7 天
      const dueAt = new Date(reportedAt.getTime() + 24 * 60 * 60 * 1000);
      const ticketNo = genNo(isScan ? "QC" : "TK", idx);
      const waybillCode = `WB${10000 + idx}`;
      const closedAt = (plan.status === "done" || plan.status === "closed") ? reportedAt : null;
      const status = plan.status;

      const ticketRows = await sql`
        INSERT INTO v3_tickets (ticket_no, waybill_code, exception_type, exception_source, description, reported_by_id, reported_by_name, reported_at, status, current_level, amount, due_at, last_activity_at, closed_at, version)
        VALUES (${ticketNo}, ${waybillCode}, ${exType}, ${isScan ? "scan" : "manual"}, ${"模拟" + EXCEPTION_META[exType].label + "异常"}, ${reporter.id}, ${reporter.name}, ${reportedAt}, ${status}, ${level}, ${amount.toString()}, ${dueAt}, ${reportedAt}, ${closedAt}, 1)
        RETURNING id
      `;
      const ticketId = ticketRows[0].id as string;

      // done 状态：生成审批记录 + 赔付（可追溯）
      if (status === "done") {
        const approver = level === 1 ? APPROVERS[0] : APPROVERS[1];
        const apprRows = await sql`
          INSERT INTO v3_approval_records (ticket_id, approver_id, approver_name, level, decision, comment, request_id, created_at)
          VALUES (${ticketId}, ${approver.id}, ${approver.name}, ${level}, 'approve', '模拟审批通过', ${"seed-" + ticketId}, ${reportedAt})
          RETURNING id
        `;
        const approvalId = apprRows[0].id as string;
        const action = EXCEPTION_ACTION_MAP[exType];
        if (action && action.compensateDirection !== "none") {
          await sql`
            INSERT INTO v3_compensations (ticket_id, approval_record_id, amount, direction, type, status, created_at)
            VALUES (${ticketId}, ${approvalId}, ${amount.toString()}, ${action.compensateDirection}, ${action.compensateType}, 'done', ${reportedAt})
          `;
        }
      }

      // rejected 状态：生成拒绝审批记录
      if (status === "rejected") {
        const approver = level === 1 ? APPROVERS[0] : APPROVERS[1];
        await sql`
          INSERT INTO v3_approval_records (ticket_id, approver_id, approver_name, level, decision, comment, request_id, created_at)
          VALUES (${ticketId}, ${approver.id}, ${approver.name}, ${level}, 'reject', '模拟拒绝', ${"seed-rej-" + ticketId}, ${reportedAt})
        `;
      }

      // scan 来源：生成扫描记录（批次状态独立）
      if (isScan) {
        const batchStatus = (status === "done" || status === "closed") ? "released" : "qc_hold";
        await sql`
          INSERT INTO v3_scan_records (waybill_code, sku_code, sku_name, batch_no, scanned_by_id, scanned_by_name, scanned_at, qc_result, qc_reason, batch_status, ticket_id, created_at)
          VALUES (${waybillCode}, ${"SKU" + (1000 + idx)}, ${"商品" + idx}, ${"BATCH" + (idx % 10)}, ${reporter.id}, ${reporter.name}, ${reportedAt}, 'fail', ${"命中品控规则：" + EXCEPTION_META[exType].label}, ${batchStatus}, ${ticketId}, ${reportedAt})
        `;
      }
    }
  }

  console.log(`✅ 完成：${idx} 条工单 + ${CONFIG_DEFAULTS ? Object.keys(CONFIG_DEFAULTS).length : 0} 配置项 + ${qcRules.length} 品控规则 + ${users.length} 用户`);
}

main().catch((e) => { console.error("❌ seed 失败：", e); process.exit(1); });
