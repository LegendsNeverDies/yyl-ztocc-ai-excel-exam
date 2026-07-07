import type { TicketStatus } from "@/types";

/**
 * 工单状态机（物流类 + 品控类共用审批流程）
 *
 * pending → level1_reviewing → [金额超阈值] level2_reviewing → executing → done
 *                          ↘ [未超阈值] executing → done
 * 任何审批中 → rejected（拒绝）
 * rejected → pending（重提，≤上限）/ closed（超上限）
 * 超时：pending/level1 → level2（升级）；level2 → closed（兜底驳回）
 */
const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  pending: ["level1_reviewing", "level2_reviewing", "closed"],
  level1_reviewing: ["level2_reviewing", "executing", "rejected", "closed"],
  level2_reviewing: ["executing", "rejected", "closed"],
  rejected: ["pending", "closed"],
  executing: ["done"],
  done: [],
  closed: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return (TICKET_TRANSITIONS[from] || []).includes(to);
}

/** 一级审批通过后，按金额决定下一状态 */
export function nextStatusOnApprove(
  current: TicketStatus,
  amount: number,
  thresholdL2: number
): TicketStatus {
  if (current === "level1_reviewing") {
    return amount >= thresholdL2 ? "level2_reviewing" : "executing";
  }
  if (current === "level2_reviewing") return "executing";
  return current;
}

/** 超时自动流转（后台/懒触发用） */
export function nextStatusOnTimeout(current: TicketStatus): TicketStatus {
  if (current === "pending" || current === "level1_reviewing") return "level2_reviewing";
  if (current === "level2_reviewing") return "closed"; // 二级超时兜底驳回
  return current;
}

/** 判断工单是否处于"审批中"可操作状态 */
export function isReviewing(status: TicketStatus): boolean {
  return status === "level1_reviewing" || status === "level2_reviewing";
}

/** 是否终态 */
export function isTerminal(status: TicketStatus): boolean {
  return status === "done" || status === "closed";
}

/**
 * 扫描批次状态机（独立于工单状态）
 * scanned → qc_passed(通过出库) / qc_hold(品控暂扣)
 * qc_hold → released(快速放行 / 工单完成解锁)
 */
const BATCH_TRANSITIONS: Record<string, string[]> = {
  scanned: ["qc_passed", "qc_hold"],
  qc_hold: ["released"],
  qc_passed: [],
  released: [],
};

export function canTransitionBatch(from: string, to: string): boolean {
  return (BATCH_TRANSITIONS[from] || []).includes(to);
}
