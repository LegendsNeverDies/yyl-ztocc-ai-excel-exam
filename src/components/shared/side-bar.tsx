"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, ScanLine, AlertCircle, ListOrdered,
  CheckSquare, Settings, Activity, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "工作台", icon: LayoutDashboard },
  { href: "/scan", label: "扫描品控", icon: ScanLine },
  { href: "/report", label: "异常上报", icon: AlertCircle },
  { href: "/tickets", label: "工单列表", icon: ListOrdered },
  { href: "/approval", label: "待我审批", icon: CheckSquare },
  { href: "/config", label: "配置中心", icon: Settings },
  { href: "/sync", label: "接口监控", icon: Activity },
];

export function SideBar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* 桌面端：左侧固定侧边栏 */}
      <aside className="fixed left-0 top-0 z-50 hidden h-full w-[224px] flex-col bg-[#0fc6c2] shadow-[4px_0_16px_rgba(0,0,0,0.08)] lg:flex">
        <Link href="/" className="flex items-center gap-2 px-6 py-5 text-white no-underline">
          <Layers className="h-7 w-7 flex-shrink-0" />
          <div className="leading-tight">
            <div className="text-base font-bold tracking-wide">运单全流程</div>
            <div className="text-[11px] font-normal text-white/70">V3 管理系统</div>
          </div>
        </Link>
        <div className="mx-6 mb-2 h-px bg-white/20" />
        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all no-underline",
                  active
                    ? "bg-white/25 text-white shadow-sm"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                )}
              >
                <Icon className="h-[18px] w-[18px] flex-shrink-0" />
                <span>{item.label}</span>
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white" />}
              </Link>
            );
          })}
        </nav>
        <div className="px-6 py-4 text-xs leading-relaxed text-white/60">
          扫描品控 · 异常审批<br />执行联动 · 全链路追踪
        </div>
      </aside>

      {/* 移动端：顶部横条 */}
      <nav className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between overflow-x-auto bg-[#0fc6c2] px-4 shadow-md lg:hidden">
        <Link href="/" className="flex flex-shrink-0 items-center gap-2 text-white no-underline">
          <Layers className="h-6 w-6 flex-shrink-0" />
          <span className="text-sm font-bold">运单V3</span>
        </Link>
        <div className="flex items-center gap-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  "flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-2 text-xs font-medium no-underline",
                  active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"
                )}
              >
                <Icon className="h-4 w-4" />
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
