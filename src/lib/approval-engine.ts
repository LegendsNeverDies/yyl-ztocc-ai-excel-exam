import { getConfigNumber } from "@/lib/config";
import { CONFIG_KEYS } from "@/types";

/**
 * 分级审批引擎 —— 阈值可配置（v3_config），不硬编码
 * 详见 ASSUMPTIONS.md ① 分级审批金额阈值
 */

/** 决定审批层级：金额 ≥ 阈值 → 二级，否则一级 */
export async function determineLevel(amount: number): Promise<1 | 2> {
  const threshold = await getConfigNumber(CONFIG_KEYS.approvalThresholdL2);
  return amount >= threshold ? 2 : 1;
}

/** 二级审批金额阈值 */
export async function getThresholdL2(): Promise<number> {
  return getConfigNumber(CONFIG_KEYS.approvalThresholdL2) || 500;
}

/** 审批超时时间点（createdAt + 超时分钟） */
export async function computeApprovalDue(createdAt: Date): Promise<Date> {
  const minutes = (await getConfigNumber(CONFIG_KEYS.approvalTimeoutMinutes)) || 1440;
  return new Date(createdAt.getTime() + minutes * 60_000);
}

/** 品控暂扣超时时间点（独立于审批超时，远短于审批超时） */
export async function computeQcHoldDue(createdAt: Date): Promise<Date> {
  const minutes = (await getConfigNumber(CONFIG_KEYS.qcHoldTimeoutMinutes)) || 120;
  return new Date(createdAt.getTime() + minutes * 60_000);
}

/** 重提次数上限 */
export async function getResubmitLimit(): Promise<number> {
  return (await getConfigNumber(CONFIG_KEYS.resubmitLimit)) || 3;
}

/** 工单是否已超时（基于 dueAt） */
export function isOverdue(dueAt: Date | string | null): boolean {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() < Date.now();
}

/** 即将超时（剩余 2 小时内）—— 列表角标用 */
export function isApproachingOverdue(dueAt: Date | string | null): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt).getTime();
  const now = Date.now();
  const TWO_HOURS = 2 * 60 * 60_000;
  return due > now && due - now < TWO_HOURS;
}
