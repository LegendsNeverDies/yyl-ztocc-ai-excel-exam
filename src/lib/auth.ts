import { cookies } from "next/headers";
import type { Role } from "@/components/shared/role-context";

export interface ServerUser {
  role: Role;
  userId: string;
  userName: string;
}

const COOKIE_NAME = "v3_current_user";

// 服务端默认角色（cookie 缺失时用，对应 .env.local 的 CURRENT_ROLE）
const DEFAULT_USER: ServerUser = {
  role: (process.env.CURRENT_ROLE as Role) || "operator",
  userId: process.env.CURRENT_USER_ID || "u-operator-01",
  userName: process.env.CURRENT_USER_NAME || "操作员甲",
};

/**
 * 服务端获取当前登录用户（从 cookie 读取，可信源）。
 * 权限校验必须基于此函数，而非客户端传参，避免伪造。
 */
export async function getCurrentUser(): Promise<ServerUser> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return DEFAULT_USER;
  try {
    const u = JSON.parse(decodeURIComponent(raw)) as ServerUser;
    if (!u.role || !u.userId) return DEFAULT_USER;
    return u;
  } catch {
    return DEFAULT_USER;
  }
}

// 角色权限矩阵
export function canReport(u: ServerUser): boolean {
  return u.role === "operator" || u.role === "qc_manager";
}
export function canApproveLevel1(u: ServerUser): boolean {
  return u.role === "approver1";
}
export function canApproveLevel2(u: ServerUser): boolean {
  return u.role === "approver2";
}
export function canQuickRelease(u: ServerUser): boolean {
  return u.role === "qc_manager";
}
export function canScan(u: ServerUser): boolean {
  return u.role === "operator" || u.role === "qc_manager";
}
