# 系统间接口契约文档（V3 ↔ V2）

> 本文档对应考点 5，说明 V3 调用 V2 的接口列表、入参出参、鉴权、超时重试、降级方案、链路追踪。

## 一、架构概述

```
┌─────────────────┐         HTTP API          ┌─────────────────┐
│   V3 系统        │ ────────────────────────→ │   V2 系统        │
│  (运单全流程)    │   X-API-Key 鉴权          │  (录单解析)      │
│                 │ ←────────────────────────  │                 │
│  独立 Vercel    │   JSON 响应               │  独立 Vercel    │
│  独立数据库      │                           │  独立数据库      │
└─────────────────┘                           └─────────────────┘
```

- V3 与 V2 是**两个独立 Vercel 项目**，各自独立数据库（V3 用 `v3_` 前缀逻辑隔离，部署前可换独立库）。
- V3 **不直接连接 V2 数据库**，所有运单数据通过 HTTP API 获取。
- 鉴权：V3 调用 V2 时携带 `X-API-Key` 头，V2 校验通过 `EXTERNAL_API_KEY` 环境变量。

## 二、接口列表

### 1. 校验运单存在 + 获取详情

**用途**：V3 发起异常上报时的实时真实性校验（核心，杜绝伪对接）。

```
GET /api/external/waybills/:code
Header: X-API-Key: <EXTERNAL_API_KEY>
```

**路径参数**：
- `code`：V2 运单号（`shipments.external_code`）

**响应**（200）：
```json
{
  "exists": true,
  "waybill": {
    "id": "uuid",
    "externalCode": "WB10001",
    "storeName": "海口龙湖天街店",
    "receiverName": "张三",
    "receiverPhone": "13800000001",
    "receiverAddress": "海口市龙华区...",
    "skuCount": 2,
    "totalQuantity": "150",
    "submittedAt": "2026-07-06T..."
  },
  "skus": [
    { "id": "uuid", "skuCode": "SKU1001", "skuName": "矿泉水550ml", "skuQuantity": "100", "skuSpec": "箱" }
  ],
  "fetchedAt": "2026-07-06T..."
}
```

**响应**（404，运单不存在）：
```json
{ "exists": false, "waybill": null, "skus": [] }
```

**响应**（401，鉴权失败）：
```json
{ "error": "unauthorized", "message": "无效或缺失的 API Key" }
```

### 2. 校验 SKU 是否归属于指定运单

**用途**：V3 扫描录入时验证扫描到的 SKU 确实在该运单明细中，避免扫描无关货物。

```
GET /api/external/waybills/:code/skus?skuCode=XXX
Header: X-API-Key: <EXTERNAL_API_KEY>
```

**响应**（200，带 skuCode 时）：
```json
{
  "exists": true,
  "belongs": true,
  "sku": { "skuCode": "SKU1001", "skuName": "矿泉水550ml", "skuQuantity": "100", "skuSpec": "箱" }
}
```

**响应**（200，SKU 不归属）：
```json
{ "exists": true, "belongs": false, "sku": null }
```

**响应**（404，运单不存在）：
```json
{ "exists": false, "belongs": false }
```

### 3. 运单列表同步

**用途**：V3 本地快照表的初始化或增量同步。

```
GET /api/external/waybills?page=1&pageSize=20
Header: X-API-Key: <EXTERNAL_API_KEY>
```

**响应**（200）：
```json
{
  "rows": [ { "id": "uuid", "externalCode": "WB10001", "storeName": "...", ... } ],
  "total": 10,
  "page": 1,
  "pageSize": 20,
  "syncedAt": "2026-07-06T..."
}
```

### 4. 异常标记回写（加分项）

**用途**：V3 工单创建时回写 V2，让 V2 知道该运单存在未关闭异常，避免 V2 继续按正常运单处理（如重复发货）。V3 工单关闭时清除标记。

```
POST /api/external/waybills/:code/flag
Header: X-API-Key: <EXTERNAL_API_KEY>
Content-Type: application/json

Body: { "ticketId": "uuid", "ticketNo": "TK...", "reason": "异常上报：丢件" }
```

**响应**（200）：
```json
{ "success": true, "code": "WB10001", "flaggedAt": "2026-07-06T..." }
```

**清除标记**：
```
DELETE /api/external/waybills/:code/flag
Header: X-API-Key: <EXTERNAL_API_KEY>
```

## 三、鉴权机制

- **方式**：API Key（`X-API-Key` 请求头）。
- **配置**：V2 的 `EXTERNAL_API_KEY` 环境变量，V3 的 `V2_API_KEY` 环境变量，两者值相同。
- **校验**：V2 的 `src/lib/external-auth.ts` 的 `checkExternalAuth()` 校验每个请求。
- **失败响应**：401 + `{"error":"unauthorized"}`。
- **安全说明**：不要求企业级 OAuth，但绝无裸奔开放接口。生产建议叠加 IP 白名单 + HTTPS。

## 四、超时与重试策略

| 参数 | 默认值 | 说明 |
|---|---|---|
| 超时时间 | 8000ms | `v3_config.v2_api_timeout_ms`，AbortController 实现 |
| 重试次数 | 2 次 | `v3_config.v2_api_retry`，失败后重试 |
| 重试间隔 | 立即 | 不做指数退避（简化，重试 1-2 次足够） |

**实现**：`src/lib/v2-client.ts` 的 `callV2()` 函数。

**幂等性保证**：
- `GET` 请求天然幂等，重试安全。
- `POST /flag` 用 `ON CONFLICT DO UPDATE`（upsert），重复调用结果一致，幂等。
- `DELETE /flag` 幂等（删除不存在的标记也返回成功）。

## 五、V2 不可用时的降级方案

**触发条件**：V2 接口超时、网络错误、HTTP 5xx。

**降级策略**：
1. **发起异常上报**：**不允许降级**。上报必须实时校验运单存在，V2 不可用时直接报错提示用户稍后重试（`createTicket()` 抛错）。
2. **扫描录入**：**不允许降级**。SKU 归属校验必须实时，V2 不可用时拒绝扫描。
3. **工单详情页展示运单信息**：**允许降级**到本地快照（`fetchWaybillByCode(allowCache: true)`），前端明确标注"本地缓存，同步于 XX 时间"，不白屏不崩溃。
4. **异常标记回写**：**失败不阻塞**主流程（`flagWaybill()` 返回 false 不抛错），V2 恢复后下次操作会重新标记。

**恢复后行为**：V2 恢复后，V3 自动继续正常工作，无需人工介入。降级期间的本地快照会在下次实时调用时自动刷新。

## 六、Request ID 链路追踪（考点5满分项）

**生成**：每次 V3 调用 V2 生成唯一 `requestId`（格式 `req-<timestamp36>-<random>`）。

**记录**：写入 `v3_sync_logs` 表，字段包括：
- `request_id`：唯一标识
- `called_at`：调用时间
- `api_name`：接口名（如 `GET /api/external/waybills/:code`）
- `params_summary`：入参摘要（如 `code=WB10001`）
- `response_status`：HTTP 状态码
- `success`：成功/失败
- `duration_ms`：耗时
- `error_message`：错误信息（区分"V2 返回 404 运单不存在"和"网络超时"）

**还原调用链**：通过 `requestId` 在 `/sync` 接口监控页可查到任一次调用的完整信息，包括耗时、错误类型，便于排查"数据为什么对不上"。

**错误日志区分**：
- `response_status=404` + `error_message="V2 接口返回 404"` → 运单不存在
- `response_status=0` + `error_message="超时(8000ms)"` → 网络超时
- `response_status=0` + `error_message="fetch failed"` → 连接失败
- `response_status=500` → V2 内部错误

## 七、数据新鲜度与一致性策略

**同步频率**：实时拉取（realtime）为主。
- 发起上报/扫描时：实时调用 V2。
- 工单详情页：实时调用 V2，失败降级快照。
- 列表页：不主动同步，按需拉取。

**V2 数据变更处理**：
- 采用实时校验 + 差异记录策略。
- 每次关键动作重新拉取 V2，若与工单创建时不一致，在审批记录标注差异。
- 不做自动对账（成本高），人工兜底。

**详见**：`ASSUMPTIONS.md` ⑥ V2 数据同步频率与一致性策略。

## 八、接口字段兼容原则

1. V2 接口字段只增不删，类型不变。
2. V3 侧对 V2 字段全部用 `| null` 兼容空值。
3. V2 升级字段类型时，V3 用 `String()` 转换后入库，类型变化不影响。
4. 详细策略见 `ASSUMPTIONS.md` "老系统二开意识"章节。

## 九、本地开发配置

V3 的 `.env.local`：
```
V2_API_BASE_URL=http://localhost:3000   # V2 dev server
V2_API_KEY=v2-external-key-2026         # 与 V2 的 EXTERNAL_API_KEY 一致
```

V2 的 `.env.local`：
```
EXTERNAL_API_KEY=v2-external-key-2026
```

**调试步骤**：
1. 启动 V2：`cd 2026060502 && npm run dev`（端口 3000）
2. V2 种子运单：`npx tsx scripts/seed-shipments.ts`（生成 WB10001-WB10010）
3. 启动 V3：`cd 2026060503 && npm run dev`（端口 3001）
4. V3 上报页输入 `WB10001` 实时校验，应返回运单详情。
5. V3 接口监控页 `/sync` 查看调用日志。

**部署后**：V3 的 `V2_API_BASE_URL` 改为 V2 的 Vercel 线上 URL，`V2_API_KEY` 在 Vercel 环境变量配置。
