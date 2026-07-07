"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type Role = "operator" | "approver1" | "approver2" | "qc_manager";

export const ROLE_META: Record<Role, { label: string; desc: string }> = {
  operator: { label: "操作员", desc: "扫描录入、异常上报" },
  approver1: { label: "一级审批人", desc: "一级审批" },
  approver2: { label: "二级审批人", desc: "二级审批（高金额）" },
  qc_manager: { label: "品控主管", desc: "误判快速放行" },
};

export interface CurrentUser {
  role: Role;
  userId: string;
  userName: string;
}

// 全部角色对应的固定用户（模拟登录）
export const ROLE_USERS: Record<Role, CurrentUser> = {
  operator: { role: "operator", userId: "u-operator-01", userName: "操作员甲" },
  approver1: { role: "approver1", userId: "u-approver1-01", userName: "审批人乙" },
  approver2: { role: "approver2", userId: "u-approver2-01", userName: "审批人丙" },
  qc_manager: { role: "qc_manager", userId: "u-qcmanager-01", userName: "品控主管丁" },
};

const DEFAULT_USER: CurrentUser = ROLE_USERS.operator;
const COOKIE_NAME = "v3_current_user";

interface RoleContextValue {
  user: CurrentUser;
  switchRole: (role: Role) => void;
  hasRole: (...roles: Role[]) => boolean;
}

const RoleContext = createContext<RoleContextValue>({
  user: DEFAULT_USER,
  switchRole: () => {},
  hasRole: () => false,
});

export function useRole() {
  return useContext(RoleContext);
}

function readCookieUser(): CurrentUser | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + COOKIE_NAME + "=([^;]*)"));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1])) as CurrentUser;
  } catch {
    return null;
  }
}

function writeCookieUser(u: CurrentUser) {
  if (typeof document === "undefined") return;
  const val = encodeURIComponent(JSON.stringify(u));
  // 7 天有效，同源
  document.cookie = `${COOKIE_NAME}=${val}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<CurrentUser>(DEFAULT_USER);

  useEffect(() => {
    const saved = readCookieUser();
    if (saved) setUserState(saved);
  }, []);

  const switchRole = useCallback((role: Role) => {
    const u = ROLE_USERS[role];
    setUserState(u);
    writeCookieUser(u);
  }, []);

  const hasRole = useCallback(
    (...roles: Role[]) => roles.includes(user.role),
    [user.role]
  );

  return (
    <RoleContext.Provider value={{ user, switchRole, hasRole }}>
      {children}
    </RoleContext.Provider>
  );
}
