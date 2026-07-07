"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getTicketDetail, approveTicket, rejectTicket, quickRelease, resubmitTicket } from "@/lib/server-actions";
import { useToast } from "@/components/shared/toast";
import { useRole } from "@/components/shared/role-context";
import { TICKET_STATUS_META, EXCEPTION_META, EXCEPTION_SOURCE_META, EXCEPTION_ACTION_MAP, type TicketStatus, type ExceptionType } from "@/types";
import { isOverdue } from "@/lib/approval-engine";
import { formatDateTime } from "@/lib/utils";
import { ArrowLeft, Loader2, Check, X, Zap, RefreshCw, Package, AlertCircle, History, Coins, ScanLine } from "lucide-react";

interface DetailData {
  ticket: Record<string, unknown>;
  approvals: Record<string, unknown>[];
  compensations: Record<string, unknown>[];
  scans: Record<string, unknown>[];
  waybill: { exists: boolean; waybill: Record<string, unknown> | null; skus: unknown[] } | null;
  waybillSource: string;
}

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const { user, hasRole } = useRole();
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [quickReason, setQuickReason] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getTicketDetail(params.id as string);
      setData(d as DetailData);
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [params.id, showToast]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-[#0fc6c2]" /></div>;
  if (!data) return <div className="py-20 text-center text-sm text-[#86909c]">工单不存在</div>;

  const t = data.ticket;
  const st = t.status as TicketStatus;
  const et = t.exception_type as ExceptionType;
  const src = t.exception_source as "scan" | "manual";
  const isReporter = t.reported_by_id === user.userId;
  const isApprover1 = hasRole("approver1");
  const isApprover2 = hasRole("approver2");
  const isQcManager = hasRole("qc_manager");
  const dueAt = t.due_at as string | null;
  const overdue = isOverdue(dueAt) && ["pending", "level1_reviewing", "level2_reviewing"].includes(st);

  const canApprove = (st === "level1_reviewing" && isApprover1 && !isReporter) || (st === "level2_reviewing" && isApprover2 && !isReporter);
  const canQuick = src === "scan" && isQcManager && st !== "done" && st !== "closed";
  const canResubmit = st === "rejected" && isReporter;

  const act = async (fn: () => Promise<{ success: boolean; message: string }>, reload = true) => {
    setActing(true);
    try {
      const r = await fn();
      showToast(r.message, r.success ? "success" : "info");
      if (r.success && reload) { setComment(""); setQuickReason(""); await load(); }
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <button onClick={() => router.push("/tickets")} className="btn-ghost mb-4 gap-1 text-sm"><ArrowLeft className="h-4 w-4" />返回列表</button>

      {/* 顶部 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-bold text-[#1d2129]">{t.ticket_no as string}</h1>
        <span className={`tag ${TICKET_STATUS_META[st].tag}`}>{TICKET_STATUS_META[st].label}</span>
        <span className={`tag ${EXCEPTION_SOURCE_META[src].tag}`}>{EXCEPTION_SOURCE_META[src].label}</span>
        {overdue && <span className="tag tag-red animate-pulse"><AlertCircle className="mr-1 h-3 w-3" />已超时</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {/* 工单信息 */}
          <div className="card">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1d2129]"><AlertCircle className="h-4 w-4 text-[#0fc6c2]" />工单信息</h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
              <div><span className="text-[#86909c]">异常类型：</span>{EXCEPTION_META[et]?.label ?? et}</div>
              <div><span className="text-[#86909c]">金额：</span>¥{Number(t.amount ?? 0).toFixed(2)}</div>
              <div><span className="text-[#86909c]">当前层级：</span>{t.current_level as number}</div>
              <div><span className="text-[#86909c]">上报人：</span>{t.reported_by_name as string}</div>
              <div><span className="text-[#86909c]">上报时间：</span>{formatDateTime(t.reported_at as string)}</div>
              <div><span className="text-[#86909c]">超时时间：</span>{formatDateTime(dueAt)}</div>
              <div className="col-span-2 md:col-span-3"><span className="text-[#86909c]">描述：</span>{(t.description as string) || "-"}</div>
              <div className="col-span-2 md:col-span-3"><span className="text-[#86909c]">下游动作：</span>{EXCEPTION_ACTION_MAP[et]?.description ?? "-"}</div>
            </div>
          </div>

          {/* 运单信息（来源标注） */}
          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[#1d2129]"><Package className="h-4 w-4 text-[#0fc6c2]" />关联运单</h2>
              <span className={`tag ${data.waybillSource === "realtime" ? "tag-green" : "tag-orange"}`}>
                {data.waybillSource === "realtime" ? "实时获取自 V2" : "本地缓存，同步于 " + formatDateTime(data.waybill ? null : null)}
              </span>
            </div>
            {data.waybill?.exists && data.waybill.waybill ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
                <div><span className="text-[#86909c]">运单号：</span>{String(data.waybill.waybill.externalCode ?? "-")}</div>
                <div><span className="text-[#86909c]">收货门店：</span>{String(data.waybill.waybill.storeName ?? "-")}</div>
                <div><span className="text-[#86909c]">收件人：</span>{String(data.waybill.waybill.receiverName ?? "-")}</div>
                <div><span className="text-[#86909c]">电话：</span>{String(data.waybill.waybill.receiverPhone ?? "-")}</div>
                <div><span className="text-[#86909c]">SKU种类：</span>{String(data.waybill.waybill.skuCount ?? "-")}</div>
                <div><span className="text-[#86909c]">总数量：</span>{String(data.waybill.waybill.totalQuantity ?? "-")}</div>
              </div>
            ) : <p className="text-sm text-[#86909c]">运单信息获取失败</p>}
          </div>

          {/* 审批历史时间线 */}
          <div className="card">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1d2129]"><History className="h-4 w-4 text-[#0fc6c2]" />状态变更历史（审计日志）</h2>
            {data.approvals.length === 0 ? (
              <p className="py-4 text-center text-sm text-[#86909c]">暂无审批记录</p>
            ) : (
              <ol className="relative">
                {data.approvals.map((a, i) => {
                  const decision = a.decision as string;
                  const decisionLabel: Record<string, { label: string; color: string }> = {
                    approve: { label: "通过", color: "#17c964" },
                    reject: { label: "拒绝", color: "#cf1322" },
                    timeout_escalate: { label: "超时流转", color: "#BA7517" },
                    quick_release: { label: "快速放行", color: "#0fc6c2" },
                    reassign: { label: "转交", color: "#86909c" },
                  };
                  const meta = decisionLabel[decision] || { label: decision, color: "#86909c" };
                  return (
                    <li key={a.id as string} className="timeline-node pb-4 last:pb-0">
                      {i < data.approvals.length - 1 && <span className="timeline-line active" />}
                      <span className="relative z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: meta.color }}>{(a.level as number) || "·"}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#1d2129]">{a.approver_name as string}</span>
                          <span className="tag" style={{ background: meta.color + "20", color: meta.color }}>{meta.label}</span>
                          <span className="text-xs text-[#86909c]">{formatDateTime(a.created_at as string)}</span>
                        </div>
                        {(a.comment as string) && <p className="mt-0.5 text-xs text-[#4e5969]">{a.comment as string}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>

        {/* 右侧：操作 + 赔付 + 扫描 */}
        <div className="space-y-4">
          {/* 操作区 */}
          {(canApprove || canQuick || canResubmit) && (
            <div className="card">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1d2129]"><Zap className="h-4 w-4 text-[#0fc6c2]" />操作</h2>
              {canApprove && (
                <div className="space-y-2">
                  <textarea className="input-field text-sm" rows={3} placeholder="审批意见..." value={comment} onChange={(e) => setComment(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={() => act(() => approveTicket({ ticketId: t.id as string, comment, requestId: crypto.randomUUID() }))} disabled={acting} className="btn-primary flex-1 gap-1 text-sm"><Check className="h-4 w-4" />通过</button>
                    <button onClick={() => act(() => rejectTicket({ ticketId: t.id as string, comment, requestId: crypto.randomUUID() }))} disabled={acting} className="btn-danger flex-1 gap-1 text-sm"><X className="h-4 w-4" />拒绝</button>
                  </div>
                  <p className="text-[10px] text-[#86909c]">并发保护：若他人已处理将提示刷新；重复点击幂等</p>
                </div>
              )}
              {canQuick && (
                <div className="space-y-2 border-t border-[#e5e6eb] pt-3">
                  <p className="text-xs font-medium text-[#BA7517]">品控主管误判快速放行（绕过审批，需留痕）</p>
                  <input className="input-field text-sm" placeholder="复核原因..." value={quickReason} onChange={(e) => setQuickReason(e.target.value)} />
                  <button onClick={() => act(() => quickRelease({ ticketId: t.id as string, reason: quickReason, requestId: crypto.randomUUID() }))} disabled={acting || !quickReason} className="btn-outline w-full gap-1 text-sm"><Zap className="h-4 w-4" />快速放行</button>
                </div>
              )}
              {canResubmit && (
                <div className="space-y-2 border-t border-[#e5e6eb] pt-3">
                  <p className="text-xs text-[#86909c]">工单已被拒绝（重提次数 {t.resubmit_count as number}/{t.max_resubmit as number}）</p>
                  <button onClick={() => act(() => resubmitTicket(t.id as string))} disabled={acting} className="btn-primary w-full gap-1 text-sm"><RefreshCw className="h-4 w-4" />重新提交</button>
                </div>
              )}
            </div>
          )}

          {/* 赔付记录 */}
          {data.compensations.length > 0 && (
            <div className="card">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1d2129]"><Coins className="h-4 w-4 text-[#0fc6c2]" />赔付记录</h2>
              {data.compensations.map((c) => (
                <div key={c.id as string} className="mb-2 rounded-md border border-[#e5e6eb] p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[#1d2129]">¥{Number(c.amount ?? 0).toFixed(2)}</span>
                    <span className={`tag ${c.direction === "to_customer" ? "tag-blue" : "tag-orange"}`}>{c.direction === "to_customer" ? "赔付客户" : "向供应商追偿"}</span>
                  </div>
                  <div className="mt-1 text-[#86909c]">类型：{c.type as string} | 触发审批：{(c.approval_record_id as string)?.slice(0, 8) ?? "-"}</div>
                </div>
              ))}
            </div>
          )}

          {/* 扫描记录 */}
          {data.scans.length > 0 && (
            <div className="card">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1d2129]"><ScanLine className="h-4 w-4 text-[#0fc6c2]" />扫描记录（{data.scans.length}）</h2>
              {data.scans.map((s) => (
                <div key={s.id as string} className="mb-2 rounded-md border border-[#e5e6eb] p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[#1d2129]">{s.sku_code as string}</span>
                    <span className={`tag ${s.batch_status === "released" ? "tag-green" : s.batch_status === "qc_hold" ? "tag-red" : "tag-gray"}`}>{s.batch_status as string}</span>
                  </div>
                  <div className="mt-1 text-[#86909c]">批次：{s.batch_no as string} | {formatDateTime(s.scanned_at as string)}</div>
                  {(s.qc_reason as string) && <div className="mt-0.5 text-[#4e5969]">{s.qc_reason as string}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
