# 运单全流程管理系统 V3

> 录单 → 扫描品控 → 异常上报 → 分级审批 → 执行联动 —— 运单全生命周期管理

## 项目定位

V3 是独立部署的运单全流程管理平台，承接 V2（AI 录单解析）的输出数据，覆盖运单从入仓到交付的完整链路。V3 与 V2 是**两个独立 Vercel 项目、独立数据库**，通过 HTTP API 互通。

## 核心能力

| 模块 | 说明 |
|---|---|
| 扫描品控 | 扫描 SKU 实时校验 V2 归属，品控规则引擎自动判定，异常自动暂扣批次+建单 |
| 异常上报 | 实时调用 V2 接口校验运单真实性，支持物流类/品控类异常 |
| 分级审批 | 金额阈值可配置，一级/二级审批，乐观锁并发保护，幂等性，超时自动流转 |
| 执行联动 | 审批通过联动赔付+库存+批次解锁，事务保证一致性，可追溯 |
| 工单追踪 | 列表筛选分页，详情审计日志，超时角标，200 条规模化数据 |
| 接口监控 | V2 调用链路日志，Request ID 追踪，成功率统计，降级标注 |

## 技术栈

- Next.js 16.2.6 App Router + TypeScript + Tailwind v4
- Drizzle ORM + Neon Postgres（复用 V2 实例，`v3_` 前缀逻辑隔离）
- 视觉与 V2 统一（主色 `#0fc6c2`、左侧侧边栏、圆角卡片）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 .env.local（参考下方环境变量）

# 3. 建表（用 DDL 脚本，避免 drizzle-kit push 交互卡顿）
npx tsx scripts/create-tables.ts

# 4. 种子数据（200 工单 + 配置 + 品控规则 + 用户）
npm run db:seed

# 5. 启动开发服务器（端口 3001）
npm run dev
```

## 环境变量（.env.local）

```
DATABASE_URL=postgresql://...        # V3 数据库（复用 V2 Neon 实例）
V2_API_BASE_URL=http://localhost:3000  # V2 接口地址
V2_API_KEY=v2-external-key-2026        # V2 对外接口 API Key
CURRENT_ROLE=operator                  # 默认角色（cookie 缺失时用）
```

## 角色与权限（右下角浮动切换器模拟登录）

| 角色 | 上报 | 扫描 | 一级审批 | 二级审批 | 快速放行 |
|---|---|---|---|---|---|
| operator | ✅ | ✅ | ❌ | ❌ | ❌ |
| approver1 | ❌ | ❌ | ✅ | ❌ | ❌ |
| approver2 | ❌ | ❌ | ❌ | ✅ | ❌ |
| qc_manager | ✅ | ✅ | ❌ | ❌ | ✅ |

权限校验全部在后端 `src/lib/auth.ts`，前端隐藏不算数。**上报人不能审批自己提交的工单**。

## 数据模型（10 表，v3_ 前缀）

| 表 | 说明 |
|---|---|
| v3_users | 用户与角色 |
| v3_waybill_snapshots | 运单本地快照（从 V2 同步，只读） |
| v3_sync_logs | 接口同步日志（Request ID 链路） |
| v3_tickets | 异常工单（状态机 + version 乐观锁） |
| v3_approval_records | 审批记录（含 requestId 幂等令牌） |
| v3_compensations | 赔付记录（含赔付方向字段，可追溯） |
| v3_inventory | 库存（批次维度，含锁定状态） |
| v3_scan_records | 扫描记录（批次状态独立，1:N 关联工单） |
| v3_qc_rules | 品控规则（触发条件可配置） |
| v3_config | 系统配置（阈值/超时，可配置） |

## 核心考点实现

### 状态机（考点3）
- **工单状态机**：pending → level1_reviewing → [金额超阈值] level2_reviewing → executing → done；rejected → pending(≤3次)/closed
- **扫描批次状态机**：scanned → qc_passed/qc_hold → released（独立于工单状态，通过 ticket_id 关联）
- 两套状态机在 `src/lib/state-machine.ts`，状态变更在事务内完成

### 并发冲突与幂等（考点3）
- **乐观锁**：`v3_tickets.version` 字段，审批时 `WHERE version=?`，不符则"已被处理请刷新"
- **幂等**：审批/快速放行用 `requestId` 作令牌，`v3_approval_records.request_id` 唯一校验，重复点击跳过

### 一致性（考点4）
- 审批通过 → 赔付生成 + 库存联动 + 批次解锁 在 `executeActions()` 内完成
- `v3_compensations.approval_record_id` 外键关联，可追溯触发源
- 赔付方向字段：品控=向供应商追偿，物流=赔付客户

### 跨系统接口（考点5）
- V2 对外 API：`/api/external/waybills/*`（4 个接口，X-API-Key 鉴权）
- V3 客户端：`src/lib/v2-client.ts`（超时 8s + 重试 2 次 + 降级快照 + Request ID 日志）
- 接口监控页 `/sync` 展示调用链路

### 品控规则引擎（考点7）
- 规则可配置：`v3_qc_rules.trigger_condition` JSON，配置中心 UI 可编辑
- 执行可追溯：命中后记录 `ruleId` + `reason` 到 `v3_scan_records`
- 扫描幂等：同批次未关闭工单时，重复扫描只追加记录不建单

## 文档

- [ASSUMPTIONS.md](./ASSUMPTIONS.md) — 需求理解与假设说明（9 项留白 + 主动澄清 + 老系统二开）
- [API_CONTRACT.md](./API_CONTRACT.md) — 系统间接口契约文档

## 部署

### Vercel 部署
1. V3 项目导入 Vercel，独立于 V2
2. 环境变量配置：`DATABASE_URL` / `V2_API_BASE_URL`（V2 线上 URL）/ `V2_API_KEY`
3. V2 项目同样需配置 `EXTERNAL_API_KEY` 环境变量
4. 部署后 `npx tsx scripts/create-tables.ts` 建表 + `npm run db:seed` 种子

### 与 V2 的关系
- V2 仓库：`https://github.com/LegendsNeverDies/yyl-ztocc-ai-export.git`
- V2 新增了 `/api/external/waybills/*` 对外接口（4 个），供 V3 调用
- V2 与 V3 各自独立 Vercel 项目、独立部署

## 反思题（考点9，不计分）

见 `ASSUMPTIONS.md` 末尾及需求文档考点9。本系统在设计时已考虑：
1. 状态机扩展性（新增异常类型只需加 EXCEPTION_META 映射，不改状态机）
2. 规模化（200 条已验证，20 万条需加分库分表 + 异步任务，`triggerTimeoutCheck` 的全表扫描是最先撑不住的环节）
3. 老系统兼容（V2 接口版本策略 + 字段向后兼容，见 ASSUMPTIONS.md）
