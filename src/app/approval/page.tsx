"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getMyApprovals, approveTicket, rejectTicket } from "@/lib/server-actions";
import { useToast } from "@/components/shared/toast";
import { useRole } from "@/components/shared/role-context";
import { TICKET_STATUS_META, EXCEPTION_META, type ExceptionType } from "@/types";
import { formatDateTime } from "@/lib/utils";
import { isOverdue, isApproachingOverdue } from "@/lib/approval-engine";
import { CheckSquare, Check, X, Loader2, Clock, ArrowRight } from "lucide-react";

export default function ApprovalPage() {
  const { showToast } = useToast();
  const { hasRole } = useRole();
  const canApprove = hasRole("approver1", "approver2");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyApprovals();
      setRows(res.rows as Record<string, unknown>[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    setActing(id);
    try {
      const r = await approveTicket({ ticketId: id, comment: "同意", requestId: crypto.randomUUID() });
      showToast(r.message, r.success ? "success" : "info");
      if (r.success) await load();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setActing(null);
    }
  };

  const reject = async (id: string) => {
    const comment = window.prompt("请输入拒绝原因：");
    if (comment === null) return;
    setActing(id);
    try {
      const r = await rejectTicket({ ticketId: id, comment, requestId: crypto.randomUUID() });
      showToast(r.message, r.success ? "success" : "info");
      if (r.success) await load();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setActing(null);
    }
  };

  if (!canApprove) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="card text-center">
          <CheckSquare className="mx-auto h-12 w-12 text-[#86909c] opacity-40" />
          <h2 className="mt-3 text-base font-semibold text-[#4e5969]">无审批权限</h2>
          <p className="mt-1 text-sm text-[#86909c]">仅一级/二级审批人可查看待审批工单。请在右下角切换角色。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[#1d2129]"><CheckSquare className="h-6 w-6 text-[#0fc6c2]" />待我审批</h1>
        <p className="mt-1 text-sm text-[#86909c]">按当前角色层级匹配的待审批工单（已排除自己上报的）· 共 {rows.length} 条</p>
      </div>

      {loading ? (
        <div className="card py-12 text-center text-sm text-[#86909c]">加载中...</div>
      ) : rows.length === 0 ? (
        <div className="card py-12 text-center text-sm text-[#86909c]">暂无待审批工单</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const et = r.exception_type as ExceptionType;
            const dueAt = r.due_at as string | null;
            const overdue = isOverdue(dueAt);
            const near = isApproachingOverdue(dueAt);
            return (
              <div key={r.id as string} className={`card flex items-center gap-4 ${overdue ? "border-l-4 border-l-[#cf1322]" : near ? "border-l-4 border-l-[#f5a524]" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-[#1d2129]">{r.ticket_no as string}</span>
                    <span className={`tag ${r.exception_source === "scan" ? "tag-teal" : "tag-blue"}`}>{r.exception_source === "scan" ? "扫描" : "手工"}</span>
                    <span className="text-xs text-[#86909c]">{EXCEPTION_META[et]?.label ?? et}</span>
                    {overdue && <span className="tag tag-red animate-pulse"><Clock className="mr-1 h-3 w-3" />超时</span>}
                    {near && !overdue && <span className="tag tag-orange">即将超时</span>}
                  </div>
                  <div className="mt-1 text-xs text-[#86909c]">
                    运单 {r.waybill_code as string} · ¥{Number(r.amount ?? 0).toFixed(2)} · 层级 {r.current_level as number} · 上报人 {r.reported_by_name as string} · {formatDateTime(r.reported_at as string)}
                  </div>
                  {(r.description as string) && <p className="mt-1 truncate text-xs text-[#4e5969]">{r.description as string}</p>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <Link href={`/tickets/${r.id as string}`} className="btn-ghost gap-1 text-xs"><ArrowRight className="h-3.5 w-3.5" />详情</Link>
                  <button onClick={() => approve(r.id as string)} disabled={acting === r.id} className="btn-primary gap-1 text-xs"><Check className="h-3.5 w-3.5" />通过</button>
                  <button onClick={() => reject(r.id as string)} disabled={acting === r.id} className="btn-danger gap-1 text-xs"><X className="h-3.5 w-3.5" />拒绝</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
