/**
 * 直接用 DDL 建 V3 的 10 张表（CREATE TABLE IF NOT EXISTS）。
 * 复用 V2 Neon 实例，v3_ 前缀隔离。
 * 注意：neon 的 sql.unsafe() 对 DDL 不生效，必须用 sql`...` tagged template。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("正在创建 V3 表（v3_ 前缀）...");

  await sql`CREATE TABLE IF NOT EXISTS v3_users (
    id varchar(64) primary key,
    name varchar(100) not null,
    role varchar(32) not null,
    active boolean not null default true,
    created_at timestamptz default now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS v3_waybill_snapshots (
    id uuid default gen_random_uuid() primary key,
    waybill_code varchar(255) not null,
    store_name varchar(255),
    receiver_name varchar(255),
    receiver_phone varchar(50),
    receiver_address text,
    sku_count integer default 0,
    total_quantity numeric default '0',
    amount numeric(12,2) default '0',
    synced_at timestamptz default now(),
    sync_source varchar(32) default 'realtime',
    raw_json jsonb,
    created_at timestamptz default now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS v3_sync_logs (
    id uuid default gen_random_uuid() primary key,
    request_id varchar(64) not null,
    called_at timestamptz default now(),
    api_name varchar(100) not null,
    params_summary text,
    response_status integer,
    success boolean not null default false,
    duration_ms integer,
    error_message text,
    direction varchar(16) default 'v3_to_v2'
  )`;

  await sql`CREATE TABLE IF NOT EXISTS v3_tickets (
    id uuid default gen_random_uuid() primary key,
    ticket_no varchar(32) not null unique,
    waybill_code varchar(255) not null,
    exception_type varchar(32) not null,
    exception_source varchar(16) not null,
    description text,
    reported_by_id varchar(64) not null,
    reported_by_name varchar(100) not null,
    reported_at timestamptz default now(),
    status varchar(32) not null default 'pending',
    current_level integer default 1,
    amount numeric(12,2) default '0',
    resubmit_count integer default 0,
    max_resubmit integer default 3,
    version integer not null default 1,
    assigned_approver_id varchar(64),
    due_at timestamptz,
    last_activity_at timestamptz default now(),
    closed_at timestamptz,
    qc_batch_id varchar(64),
    ai_suggestion jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS v3_approval_records (
    id uuid default gen_random_uuid() primary key,
    ticket_id uuid not null references v3_tickets(id) on delete cascade,
    approver_id varchar(64) not null,
    approver_name varchar(100) not null,
    level integer not null,
    decision varchar(32) not null,
    comment text,
    request_id varchar(64) not null,
    created_at timestamptz default now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS v3_compensations (
    id uuid default gen_random_uuid() primary key,
    ticket_id uuid not null references v3_tickets(id) on delete cascade,
    approval_record_id uuid references v3_approval_records(id),
    amount numeric(12,2) not null,
    direction varchar(20) not null,
    type varchar(32) not null,
    status varchar(16) default 'done',
    created_at timestamptz default now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS v3_inventory (
    id uuid default gen_random_uuid() primary key,
    sku_code varchar(255) not null,
    sku_name varchar(500),
    batch_no varchar(64) not null,
    quantity integer not null default 0,
    locked boolean not null default false,
    locked_by_ticket_id uuid,
    updated_at timestamptz default now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS v3_scan_records (
    id uuid default gen_random_uuid() primary key,
    waybill_code varchar(255) not null,
    sku_code varchar(255) not null,
    sku_name varchar(500),
    batch_no varchar(64) not null,
    scanned_by_id varchar(64) not null,
    scanned_by_name varchar(100) not null,
    scanned_at timestamptz default now(),
    qc_result varchar(16) not null,
    qc_rule_id uuid,
    qc_reason text,
    batch_status varchar(32) not null default 'scanned',
    ticket_id uuid,
    note text,
    created_at timestamptz default now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS v3_qc_rules (
    id uuid default gen_random_uuid() primary key,
    name varchar(255) not null,
    exception_sub_type varchar(32) not null,
    trigger_type varchar(32) not null,
    trigger_condition jsonb not null,
    severity varchar(16) not null default 'medium',
    auto_create_ticket boolean not null default true,
    auto_approval_level integer default 2,
    active boolean not null default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS v3_config (
    id uuid default gen_random_uuid() primary key,
    key varchar(64) not null unique,
    value text not null,
    category varchar(32) not null,
    description text,
    updated_at timestamptz default now()
  )`;

  await sql`CREATE INDEX IF NOT EXISTS idx_v3_tickets_status ON v3_tickets(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_v3_tickets_waybill ON v3_tickets(waybill_code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_v3_tickets_approver ON v3_tickets(assigned_approver_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_v3_approval_ticket ON v3_approval_records(ticket_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_v3_scan_batch ON v3_scan_records(waybill_code, sku_code, batch_no)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_v3_sync_logs_called ON v3_sync_logs(called_at desc)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_v3_waybill_code ON v3_waybill_snapshots(waybill_code)`;

  // 清理临时测试表
  await sql`DROP TABLE IF EXISTS v3_test`;
  await sql`DROP TABLE IF EXISTS v3_test2`;

  console.log("✅ 完成：10 张表 + 7 个索引已创建");
}

main().catch((e) => { console.error("❌ 建表失败：", e); process.exit(1); });
