"use client";

import { useEffect, useState, useCallback } from "react";
import { getSyncLogs } from "@/lib/server-actions";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { Activity, CheckCircle, XCircle, Clock, Zap } from "lucide-react";

export default function SyncPage() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 30;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSyncLogs(page, pageSize);
      setRows(res.rows as Record<string, unknown>[]);
      setTotal(res.total);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const successCount = rows.filter((r) => r.success as boolean).length;
  const successRate = rows.length > 0 ? Math.round((successCount / rows.length) * 100) : 100;
  const lastCall = rows[0]?.called_at as string | undefined;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[#1d2129]"><Activity className="h-6 w-6 text-[#0fc6c2]" />接口同步监控</h1>
        <p className="mt-1 text-sm text-[#86909c]">V3 调用 V2 接口的链路日志（Request ID 可追踪完整调用链）</p>
      </div>

      {/* 统计 */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card !p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-[#86909c]">最近调用</span><Clock className="h-4 w-4 text-[#0fc6c2]" /></div>
          <div className="mt-1 text-sm font-medium text-[#1d2129]">{lastCall ? timeAgo(lastCall) : "-"}</div>
        </div>
        <div className="card !p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-[#86909c]">本页成功率</span><CheckCircle className="h-4 w-4 text-[#17c964]" /></div>
          <div className="mt-1 text-xl font-bold text-[#17c964]">{successRate}%</div>
        </div>
        <div className="card !p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-[#86909c]">本页成功数</span><Zap className="h-4 w-4 text-[#0fc6c2]" /></div>
          <div className="mt-1 text-xl font-bold text-[#1d2129]">{successCount}/{rows.length}</div>
        </div>
        <div className="card !p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-[#86909c]">日志总数</span><Activity className="h-4 w-4 text-[#0fc6c2]" /></div>
          <div className="mt-1 text-xl font-bold text-[#1d2129]">{total}</div>
        </div>
      </div>

      <div className="alert alert-info mb-4">
        <span className="text-sm">📋 <strong>数据来源说明</strong>：工单详情页展示运单信息时，会标注"实时获取自 V2"或"本地缓存，同步于 XX 时间"。V2 不可用时降级到快照，恢复后自动继续，无需人工介入。</span>
      </div>

      {/* 日志表格 */}
      <div className="card overflow-hidden !p-0">
        <div className="table-wrapper">
          <table className="table-styled">
            <thead>
              <tr>
                <th>Request ID</th><th>时间</th><th>接口</th><th className="text-center">状态</th>
                <th className="text-center">HTTP</th><th className="text-center">耗时</th><th>入参摘要</th><th>错误</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-10 text-center text-sm text-[#86909c]">加载中...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-sm text-[#86909c]">暂无接口日志（发起上报/扫描后会生成）</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id as string}>
                  <td className="whitespace-nowrap font-mono text-[11px] text-[#4e5969]">{r.request_id as string}</td>
                  <td className="whitespace-nowrap text-xs">{formatDateTime(r.called_at as string)}</td>
                  <td className="text-xs">{r.api_name as string}</td>
                  <td className="text-center">{r.success ? <CheckCircle className="mx-auto h-4 w-4 text-[#17c964]" /> : <XCircle className="mx-auto h-4 w-4 text-[#cf1322]" />}</td>
                  <td className="text-center text-xs">{(r.response_status as number) || "-"}</td>
                  <td className="text-center text-xs">{r.duration_ms ? `${r.duration_ms}ms` : "-"}</td>
                  <td className="max-w-[200px] truncate text-xs text-[#86909c]" title={r.params_summary as string}>{(r.params_summary as string) || "-"}</td>
                  <td className="max-w-[200px] truncate text-xs text-[#cf1322]" title={r.error_message as string}>{(r.error_message as string) || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-[#86909c]">
        <span>共 {total} 条，第 {page}/{totalPages} 页</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost p-1.5 text-xs">上一页</button>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn-ghost p-1.5 text-xs">下一页</button>
        </div>
      </div>
    </div>
  );
}
