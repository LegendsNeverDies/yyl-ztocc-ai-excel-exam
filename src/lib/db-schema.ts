import { pgTable, uuid, varchar, text, numeric, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

/**
 * V3 运单全流程管理系统 — 数据模型
 * 复用 V2 Neon 实例，所有表 v3_ 前缀做逻辑隔离（详见 ASSUMPTIONS.md）。
 */

// 1. 用户表（轻量，用于离职/禁用兜底校验）
export const v3Users = pgTable("v3_users", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  role: varchar("role", { length: 32 }).notNull(), // operator/approver1/approver2/qc_manager
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// 2. 运单本地快照（从 V2 接口同步，只读，不在此表写运单状态）
export const v3WaybillSnapshots = pgTable("v3_waybill_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  waybillCode: varchar("waybill_code", { length: 255 }).notNull(), // V2 externalCode
  storeName: varchar("store_name", { length: 255 }),
  receiverName: varchar("receiver_name", { length: 255 }),
  receiverPhone: varchar("receiver_phone", { length: 50 }),
  receiverAddress: text("receiver_address"),
  skuCount: integer("sku_count").default(0),
  totalQuantity: numeric("total_quantity").default("0"),
  amount: numeric("amount", { precision: 12, scale: 2 }).default("0"),
  syncedAt: timestamp("synced_at").defaultNow(),
  syncSource: varchar("sync_source", { length: 32 }).default("realtime"), // realtime/batch/fallback
  rawJson: jsonb("raw_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

// 3. 接口同步日志（Request ID 链路追踪）
export const v3SyncLogs = pgTable("v3_sync_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: varchar("request_id", { length: 64 }).notNull(),
  calledAt: timestamp("called_at").defaultNow(),
  apiName: varchar("api_name", { length: 100 }).notNull(),
  paramsSummary: text("params_summary"),
  responseStatus: integer("response_status"),
  success: boolean("success").notNull().default(false),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
  direction: varchar("direction", { length: 16 }).default("v3_to_v2"), // v3_to_v2 / v2_to_v3
});

// 4. 异常工单（核心，含状态机字段 + version 乐观锁）
export const v3Tickets = pgTable("v3_tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  ticketNo: varchar("ticket_no", { length: 32 }).notNull().unique(),
  waybillCode: varchar("waybill_code", { length: 255 }).notNull(),
  exceptionType: varchar("exception_type", { length: 32 }).notNull(),
  exceptionSource: varchar("exception_source", { length: 16 }).notNull(), // scan/manual
  description: text("description"),
  reportedById: varchar("reported_by_id", { length: 64 }).notNull(),
  reportedByName: varchar("reported_by_name", { length: 100 }).notNull(),
  reportedAt: timestamp("reported_at").defaultNow(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  currentLevel: integer("current_level").default(1), // 1/2
  amount: numeric("amount", { precision: 12, scale: 2 }).default("0"),
  resubmitCount: integer("resubmit_count").default(0),
  maxResubmit: integer("max_resubmit").default(3),
  version: integer("version").notNull().default(1), // 乐观锁，并发冲突保护
  assignedApproverId: varchar("assigned_approver_id", { length: 64 }),
  dueAt: timestamp("due_at"), // 超时时间点
  lastActivityAt: timestamp("last_activity_at").defaultNow(),
  closedAt: timestamp("closed_at"),
  qcBatchId: varchar("qc_batch_id", { length: 64 }), // 品控批次关联
  aiSuggestion: jsonb("ai_suggestion"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 5. 审批记录（每次审批动作一行，requestId 做幂等令牌）
export const v3ApprovalRecords = pgTable("v3_approval_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  ticketId: uuid("ticket_id").notNull().references(() => v3Tickets.id, { onDelete: "cascade" }),
  approverId: varchar("approver_id", { length: 64 }).notNull(),
  approverName: varchar("approver_name", { length: 100 }).notNull(),
  level: integer("level").notNull(), // 1/2
  decision: varchar("decision", { length: 32 }).notNull(), // approve/reject/timeout_escalate/quick_release/reassign
  comment: text("comment"),
  requestId: varchar("request_id", { length: 64 }).notNull(), // 幂等令牌
  createdAt: timestamp("created_at").defaultNow(),
});

// 6. 赔付记录（含赔付方向字段 + 关联审批记录，可追溯）
export const v3Compensations = pgTable("v3_compensations", {
  id: uuid("id").defaultRandom().primaryKey(),
  ticketId: uuid("ticket_id").notNull().references(() => v3Tickets.id, { onDelete: "cascade" }),
  approvalRecordId: uuid("approval_record_id").references(() => v3ApprovalRecords.id), // 可追溯触发源
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  direction: varchar("direction", { length: 20 }).notNull(), // to_customer / to_supplier
  type: varchar("type", { length: 32 }).notNull(), // claim/repurchase/restock/price_diff/none
  status: varchar("status", { length: 16 }).default("done"),
  createdAt: timestamp("created_at").defaultNow(),
});

// 7. 库存（批次维度，含锁定状态）
export const v3Inventory = pgTable("v3_inventory", {
  id: uuid("id").defaultRandom().primaryKey(),
  skuCode: varchar("sku_code", { length: 255 }).notNull(),
  skuName: varchar("sku_name", { length: 500 }),
  batchNo: varchar("batch_no", { length: 64 }).notNull(),
  quantity: integer("quantity").notNull().default(0),
  locked: boolean("locked").notNull().default(false),
  lockedByTicketId: uuid("locked_by_ticket_id"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 8. 扫描记录（与工单 1:N，批次状态独立字段，通过 ticket_id 关联）
export const v3ScanRecords = pgTable("v3_scan_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  waybillCode: varchar("waybill_code", { length: 255 }).notNull(),
  skuCode: varchar("sku_code", { length: 255 }).notNull(),
  skuName: varchar("sku_name", { length: 500 }),
  batchNo: varchar("batch_no", { length: 64 }).notNull(),
  scannedById: varchar("scanned_by_id", { length: 64 }).notNull(),
  scannedByName: varchar("scanned_by_name", { length: 100 }).notNull(),
  scannedAt: timestamp("scanned_at").defaultNow(),
  qcResult: varchar("qc_result", { length: 16 }).notNull(), // pass/fail
  qcRuleId: uuid("qc_rule_id"),
  qcReason: text("qc_reason"),
  batchStatus: varchar("batch_status", { length: 32 }).notNull().default("scanned"), // scanned/qc_passed/qc_hold/released
  ticketId: uuid("ticket_id"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

// 9. 品控规则（触发条件 JSON 可配置，不硬编码）
export const v3QcRules = pgTable("v3_qc_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  exceptionSubType: varchar("exception_sub_type", { length: 32 }).notNull(),
  triggerType: varchar("trigger_type", { length: 32 }).notNull(), // quantity_diff/damage_level/spec_deviation/label_error/batch_anomaly
  triggerCondition: jsonb("trigger_condition").notNull(),
  severity: varchar("severity", { length: 16 }).notNull().default("medium"), // low/medium/high
  autoCreateTicket: boolean("auto_create_ticket").notNull().default(true),
  autoApprovalLevel: integer("auto_approval_level").default(2),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 10. 配置项（KV：审批阈值/超时/重提上限等，可配置）
export const v3Config = pgTable("v3_config", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  value: text("value").notNull(),
  category: varchar("category", { length: 32 }).notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ====== 类型导出 ======
export type Ticket = typeof v3Tickets.$inferSelect;
export type ApprovalRecord = typeof v3ApprovalRecords.$inferSelect;
export type Compensation = typeof v3Compensations.$inferSelect;
export type ScanRecord = typeof v3ScanRecords.$inferSelect;
export type QcRule = typeof v3QcRules.$inferSelect;
export type WaybillSnapshot = typeof v3WaybillSnapshots.$inferSelect;
export type SyncLog = typeof v3SyncLogs.$inferSelect;
export type InventoryRow = typeof v3Inventory.$inferSelect;
export type V3User = typeof v3Users.$inferSelect;
export type ConfigItem = typeof v3Config.$inferSelect;
