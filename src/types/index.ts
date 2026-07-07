// V3 业务类型与常量

// ====== 工单状态机 ======
export type TicketStatus =
  | "pending"            // 待审批
  | "level1_reviewing"   // 一级审批中
  | "level2_reviewing"   // 二级审批中
  | "executing"          // 执行中
  | "done"               // 已完成
  | "rejected"           // 已拒绝（可重提）
  | "closed";            // 已关闭（超次数/快速放行）

export const TICKET_STATUS_META: Record<TicketStatus, { label: string; color: string; tag: string }> = {
  pending: { label: "待审批", color: "#86909c", tag: "tag-gray" },
  level1_reviewing: { label: "一级审批中", color: "#185fa5", tag: "tag-blue" },
  level2_reviewing: { label: "二级审批中", color: "#BA7517", tag: "tag-orange" },
  executing: { label: "执行中", color: "#0fc6c2", tag: "tag-teal" },
  done: { label: "已完成", color: "#17c964", tag: "tag-green" },
  rejected: { label: "已拒绝", color: "#cf1322", tag: "tag-red" },
  closed: { label: "已关闭", color: "#86909c", tag: "tag-gray" },
};

// ====== 异常类型 ======
export type ExceptionType =
  // 物流类（手工上报）
  | "lost" | "damaged" | "rejected" | "timeout" | "address_error"
  // 品控类（扫描触发）
  | "quantity_diff" | "appearance_damage" | "spec_mismatch" | "label_error" | "batch_anomaly";

export const EXCEPTION_META: Record<ExceptionType, { label: string; category: "logistics" | "qc" }> = {
  lost: { label: "丢件", category: "logistics" },
  damaged: { label: "破损", category: "logistics" },
  rejected: { label: "客户拒收", category: "logistics" },
  timeout: { label: "超时未签收", category: "logistics" },
  address_error: { label: "收货地址错误", category: "logistics" },
  quantity_diff: { label: "数量不符", category: "qc" },
  appearance_damage: { label: "外观破损", category: "qc" },
  spec_mismatch: { label: "规格不符", category: "qc" },
  label_error: { label: "标签错误", category: "qc" },
  batch_anomaly: { label: "批次异常", category: "qc" },
};

export type ExceptionSource = "scan" | "manual";
export const EXCEPTION_SOURCE_META: Record<ExceptionSource, { label: string; tag: string }> = {
  scan: { label: "扫描触发", tag: "tag-teal" },
  manual: { label: "手工上报", tag: "tag-blue" },
};

// ====== 异常类型 → 下游动作映射（考点4，详见 ASSUMPTIONS.md ④） ======
export interface DownstreamAction {
  compensateDirection: "to_customer" | "to_supplier" | "none";
  compensateType: "claim" | "repurchase" | "restock" | "price_diff" | "none";
  inventoryDelta: number; // 负=扣减, 正=增加, 0=不动
  inventoryAction: "ship_rollback" | "return_in" | "ship_out" | "scrap" | "none";
  description: string;
}

export const EXCEPTION_ACTION_MAP: Record<ExceptionType, DownstreamAction> = {
  // 物流：赔付客户
  lost: { compensateDirection: "to_customer", compensateType: "claim", inventoryDelta: 0, inventoryAction: "ship_rollback", description: "赔付客户 + 回滚原运单库存" },
  damaged: { compensateDirection: "to_customer", compensateType: "claim", inventoryDelta: 1, inventoryAction: "return_in", description: "赔付客户 + 退货入库" },
  rejected: { compensateDirection: "none", compensateType: "none", inventoryDelta: 1, inventoryAction: "return_in", description: "退货入库 + 重新发货" },
  timeout: { compensateDirection: "none", compensateType: "none", inventoryDelta: 0, inventoryAction: "none", description: "重新发货（无赔付）" },
  address_error: { compensateDirection: "none", compensateType: "none", inventoryDelta: 0, inventoryAction: "none", description: "更正地址重新发货（无赔付）" },
  // 品控：向供应商追偿
  quantity_diff: { compensateDirection: "to_supplier", compensateType: "claim", inventoryDelta: 0, inventoryAction: "ship_out", description: "退回供应商 + 向供应商追偿" },
  appearance_damage: { compensateDirection: "to_supplier", compensateType: "price_diff", inventoryDelta: 0, inventoryAction: "none", description: "降级处理 + 追偿差价" },
  spec_mismatch: { compensateDirection: "to_supplier", compensateType: "claim", inventoryDelta: 0, inventoryAction: "ship_out", description: "退回供应商 + 向供应商追偿" },
  label_error: { compensateDirection: "to_supplier", compensateType: "price_diff", inventoryDelta: 0, inventoryAction: "none", description: "降级处理 + 追偿差价" },
  batch_anomaly: { compensateDirection: "to_supplier", compensateType: "repurchase", inventoryDelta: 0, inventoryAction: "scrap", description: "批次作废 + 重新采购 + 向供应商追偿" },
};

// ====== 审批决策 ======
export type ApprovalDecision = "approve" | "reject" | "timeout_escalate" | "quick_release" | "reassign";

// ====== 扫描批次状态 ======
export type BatchStatus = "scanned" | "qc_passed" | "qc_hold" | "released";

// ====== 配置键（v3_config） ======
export const CONFIG_KEYS = {
  approvalThresholdL2: "approval_threshold_l2",       // 二级审批金额阈值
  approvalTimeoutMinutes: "approval_timeout_minutes", // 审批超时（分钟）
  qcHoldTimeoutMinutes: "qc_hold_timeout_minutes",    // 品控暂扣超时（分钟）
  resubmitLimit: "resubmit_limit",                    // 重提次数上限
  v2SyncMode: "v2_sync_mode",                         // 同步模式 realtime/batch
  v2ApiTimeoutMs: "v2_api_timeout_ms",                // V2 接口超时
  v2ApiRetry: "v2_api_retry",                         // V2 接口重试次数
} as const;

export const CONFIG_DEFAULTS: Record<string, string> = {
  approval_threshold_l2: "500",
  approval_timeout_minutes: "1440",   // 24h
  qc_hold_timeout_minutes: "120",     // 2h，远短于审批超时
  resubmit_limit: "3",
  v2_sync_mode: "realtime",
  v2_api_timeout_ms: "8000",
  v2_api_retry: "2",
};

// ====== 工单列表筛选 ======
export interface TicketFilter {
  status?: TicketStatus;
  exceptionType?: ExceptionType;
  waybillCode?: string;
  approverId?: string;
  reportedById?: string;
  page: number;
  pageSize: number;
}
