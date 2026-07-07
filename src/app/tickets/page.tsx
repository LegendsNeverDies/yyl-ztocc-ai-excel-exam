"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getTicketsPage } from "@/lib/server-actions";
import { TICKET_STATUS_META, EXCEPTION_META, EXCEPTION_SOURCE_META, type TicketStatus, type ExceptionType } from "@/types";
import { isOverdue, isApproachingOverdue } from "@/lib/approval-engine";
import { formatDateTime } from "@/lib/utils";
import { Search, ChevronLeft, ChevronRight, AlertCircle, Clock } from "lucide-react";

export default function TicketsPage() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const [status, setStatus] = useState("");
  const [exceptionType, setExceptionType] = useState("");
  const [waybillCode, setWaybillCode] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTicketsPage({
        page, pageSize,
        status: (status || undefined) as TicketStatus | undefined,
        exceptionType: (exceptionType || undefined) as ExceptionType | undefined,
        waybillCode: waybillCode || undefined,
      });
      setRows(res.rows as Record<string, unknown>[]);
      setTotal(res.total);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, exceptionType, waybillCode]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1d2129]">异常工单列表</h1>
        <p className="mt-1 text-sm text-[#86909c]">共 {total} 条 · 支持按状态/类型/运单号筛选 · 超时工单红色角标</p>
      </div>

      {/* 筛选栏 */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[160px]">
            <label className="mb-1 block text-xs font-medium text-[#86909c]">状态</label>
            <select className="input-field text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">全部</option>
              {(Object.keys(TICKET_STATUS_META) as TicketStatus[]).map((s) => (
                <option key={s} value={s}>{TICKET_STATUS_META[s].label}</option>
              ))}
            </select>
          </div>
          <div className="w-[160px]">
            <label className="mb-1 block text-xs font-medium text-[#86909c]">异常类型</label>
            <select className="input-field text-sm" value={exceptionType} onChange={(e) => { setExceptionType(e.target.value); setPage(1); }}>
              <option value="">全部</option>
              {(Object.keys(EXCEPTION_META) as ExceptionType[]).map((t) => (
                <option key={t} value={t}>{EXCEPTION_META[t].label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-[#86909c]">运单号</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#86909c]" />
              <input className="input-field pl-8 text-sm" placeholder="搜索运单号..." value={waybillCode} onChange={(e) => setWaybillCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), load())} />
            </div>
          </div>
          <button onClick={() => { setPage(1); load(); }} className="btn-primary h-[38px] text-sm">查询</button>
        </div>
      </div>

      {/* 表格 */}
      <div className="card overflow-hidden !p-0">
        <div className="table-wrapper">
          <table className="table-styled">
            <thead>
              <tr>
                <th>工单号</th><th>运单号</th><th>异常类型</th><th>来源</th><th>状态</th>
                <th className="text-center">金额</th><th>层级</th><th>上报人</th><th>上报时间</th><th className="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="py-10 text-center text-sm text-[#86909c]">加载中...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="py-10 text-center text-sm text-[#86909c]">暂无工单</td></tr>
              ) : rows.map((r) => {
                const st = r.status as TicketStatus;
                const et = r.exception_type as ExceptionType;
                const src = r.exception_source as "scan" | "manual";
                const dueAt = r.due_at as string | null;
                const overdue = isOverdue(dueAt) && ["pending", "level1_reviewing", "level2_reviewing"].includes(st);
                const near = isApproachingOverdue(dueAt) && ["pending", "level1_reviewing", "level2_reviewing"].includes(st);
                return (
                  <tr key={r.id as string}>
                    <td className="whitespace-nowrap font-mono text-xs">{r.ticket_no as string}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{r.waybill_code as string}</td>
                    <td className="text-xs">{EXCEPTION_META[et]?.label ?? et}</td>
                    <td><span className={`tag ${EXCEPTION_SOURCE_META[src].tag}`}>{EXCEPTION_SOURCE_META[src].label}</span></td>
                    <td>
                      <span className={`tag ${TICKET_STATUS_META[st].tag}`}>
                        {overdue && <Clock className="mr-1 inline h-3 w-3" />}
                        {TICKET_STATUS_META[st].label}
                        {near && !overdue && <span className="ml-1 text-[10px]">即将超时</span>}
                      </span>
                    </td>
                    <td className="text-center text-xs font-medium text-[#0b6e6e]">¥{Number(r.amount ?? 0).toFixed(2)}</td>
                    <td className="text-center text-xs">{String(r.current_level ?? "-")}</td>
                    <td className="text-xs">{r.reported_by_name as string}</td>
                    <td className="whitespace-nowrap text-xs">{formatDateTime(r.reported_at as string)}</td>
                    <td className="text-center">
                      <Link href={`/tickets/${r.id as string}`} className="btn-ghost gap-1 text-xs text-[#0fc6c2]">详情</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页 */}
      <div className="mt-4 flex items-center justify-between text-sm text-[#86909c]">
        <span>共 {total} 条，第 {page}/{totalPages} 页</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost p-1.5"><ChevronLeft className="h-4 w-4" /></button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const p = i + Math.max(1, page - 3);
            if (p > totalPages) return null;
            return (
              <button key={p} onClick={() => setPage(p)} className={`flex h-8 w-8 items-center justify-center rounded text-xs font-medium ${p === page ? "bg-[#0fc6c2] text-white" : "hover:bg-[#f0f0f0] text-[#4e5969]"}`}>{p}</button>
            );
          })}
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn-ghost p-1.5"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}
