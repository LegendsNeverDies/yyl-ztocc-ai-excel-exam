"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDashboardStats } from "@/lib/server-actions";
import { ScanLine, AlertCircle, ListOrdered, CheckSquare, Clock, TrendingUp, ArrowRight, Zap } from "lucide-react";
import { TICKET_STATUS_META, type TicketStatus } from "@/types";
import { useRole } from "@/components/shared/role-context";

export default function HomePage() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getDashboardStats>> | null>(null);
  const { user } = useRole();

  useEffect(() => { getDashboardStats().then(setStats).catch(() => {}); }, []);

  const shortcuts = [
    { href: "/scan", label: "扫描品控", desc: "扫描 SKU 触发品控检测", icon: ScanLine, roles: ["operator", "qc_manager"] as const },
    { href: "/report", label: "异常上报", desc: "对真实运单发起异常", icon: AlertCircle, roles: ["operator", "qc_manager"] as const },
    { href: "/tickets", label: "工单列表", desc: "查看所有异常工单", icon: ListOrdered, roles: ["operator", "approver1", "approver2", "qc_manager"] as const },
    { href: "/approval", label: "待我审批", desc: "处理待审批工单", icon: CheckSquare, roles: ["approver1", "approver2"] as const },
    { href: "/sync", label: "接口监控", desc: "V2 接口同步日志", icon: Zap, roles: ["operator", "approver1", "approver2", "qc_manager"] as const },
    { href: "/config", label: "配置中心", desc: "阈值/超时/品控规则", icon: ListOrdered, roles: ["approver1", "approver2", "qc_manager"] as const },
  ];
  const visibleShortcuts = shortcuts.filter((s) => s.roles.includes(user.role as never));

  const statusList = Object.entries(TICKET_STATUS_META) as [TicketStatus, typeof TICKET_STATUS_META[TicketStatus]][];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1d2129]">工作台</h1>
        <p className="mt-1 text-sm text-[#86909c]">运单全流程管理 · 扫描品控 → 异常上报 → 分级审批 → 执行联动</p>
      </div>

      {/* 统计卡片 */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card !p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#86909c]">工单总数</span>
            <ListOrdered className="h-4 w-4 text-[#0fc6c2]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[#1d2129]">{stats?.total ?? "-"}</div>
        </div>
        <div className="card !p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#86909c]">超时待处理</span>
            <Clock className="h-4 w-4 text-[#cf1322]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[#cf1322]">{stats?.overdue ?? "-"}</div>
        </div>
        <div className="card !p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#86909c]">接口成功率(24h)</span>
            <TrendingUp className="h-4 w-4 text-[#17c964]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[#17c964]">{stats ? `${stats.syncSuccessRate}%` : "-"}</div>
        </div>
        <div className="card !p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#86909c]">接口调用(24h)</span>
            <Zap className="h-4 w-4 text-[#0fc6c2]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[#1d2129]">{stats?.syncTotal ?? "-"}</div>
        </div>
      </div>

      {/* 接口失败分类（24h） */}
      <div className="mb-6 grid gap-4 sm:grid-cols-1 lg:grid-cols-1">
        <div className="card !p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#86909c]">接口失败分类（24h）</span>
            <Zap className="h-4 w-4 text-[#0fc6c2]" />
          </div>
          <div className="mt-3">
            {stats && stats.syncErrorByType ? (
              <div className="space-y-2 text-sm text-[#4e5969]">
                {Object.entries(stats.syncErrorByType).map(([t, c]) => (
                  <div key={t} className="flex items-center justify-between">
                    <div className="capitalize">{t.replace(/_/g, ' ')}</div>
                    <div className="font-medium">{c}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-[#86909c]">暂无数据</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* 工单状态分布 */}
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-[#1d2129]">
            <ListOrdered className="h-4 w-4 text-[#0fc6c2]" />工单状态分布
          </h2>
          <div className="space-y-2.5">
            {statusList.map(([status, meta]) => {
              const count = stats?.byStatus[status] ?? 0;
              const pct = stats && stats.total > 0 ? (count / stats.total) * 100 : 0;
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-[#4e5969]">{meta.label}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-[#f0f0f0]">
                    <div className="flex h-full items-center justify-end rounded px-2 text-[10px] font-medium text-white" style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%`, background: meta.color }}>
                      {count > 0 && count}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 快捷入口 */}
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-[#1d2129]">
            <ArrowRight className="h-4 w-4 text-[#0fc6c2]" />快捷入口
          </h2>
          <div className="space-y-2">
            {visibleShortcuts.map((s) => {
              const Icon = s.icon;
              return (
                <Link key={s.href} href={s.href} className="flex items-center gap-3 rounded-lg border border-[#e5e6eb] p-3 no-underline transition-all hover:border-[#0fc6c2] hover:bg-[#f7fefe]">
                  <Icon className="h-5 w-5 flex-shrink-0 text-[#0fc6c2]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#1d2129]">{s.label}</div>
                    <div className="truncate text-xs text-[#86909c]">{s.desc}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-[#86909c]" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
