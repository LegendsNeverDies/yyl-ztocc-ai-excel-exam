"use client";

import { useState } from "react";
import { useRole, ROLE_META, type Role } from "./role-context";
import { Users, ChevronUp } from "lucide-react";

/** 浮动角色切换器（模拟登录），右下角全局可见 */
export function RoleSwitcher() {
  const { user, switchRole } = useRole();
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {open && (
        <div className="card mb-2 w-60 animate-fade-in !p-3">
          <p className="mb-2 text-xs font-medium text-[#86909c]">切换角色（模拟登录）</p>
          <div className="space-y-1">
            {(Object.keys(ROLE_META) as Role[]).map((r) => (
              <button
                key={r}
                onClick={() => { switchRole(r); setOpen(false); }}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition-colors ${
                  user.role === r ? "bg-[#e8fafa] text-[#0b6e6e]" : "hover:bg-[#f0f0f0] text-[#4e5969]"
                }`}
              >
                <span className="font-medium">{ROLE_META[r].label}</span>
                <span className="text-[10px] text-[#86909c]">{ROLE_META[r].desc}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 border-t border-[#e5e6eb] pt-2 text-[10px] leading-relaxed text-[#86909c]">
            当前：<strong className="text-[#0b6e6e]">{user.userName}</strong>
            <br />权限基于 cookie，后端校验
          </p>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full bg-[#0fc6c2] px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-colors hover:bg-[#0bada9]"
      >
        <Users className="h-4 w-4" />
        <span className="max-w-[120px] truncate">{ROLE_META[user.role].label} · {user.userName}</span>
        <ChevronUp className={`h-3.5 w-3.5 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
    </div>
  );
}
