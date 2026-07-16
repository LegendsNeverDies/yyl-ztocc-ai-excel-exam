import { sql } from "@/lib/db";
import { getConfigNumber } from "@/lib/config";

const BASE = process.env.V2_API_BASE_URL;
const API_KEY = process.env.V2_API_KEY;

function genRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface LogEntry {
  requestId: string;
  apiName: string;
  paramsSummary: string;
  responseStatus: number;
  success: boolean;
  durationMs: number;
  errorMessage: string | null;
}

async function writeLog(entry: LogEntry): Promise<void> {
  try {
    await sql`
      INSERT INTO v3_sync_logs (request_id, called_at, api_name, params_summary, response_status, success, duration_ms, error_message, direction)
      VALUES (${entry.requestId}, now(), ${entry.apiName}, ${entry.paramsSummary}, ${entry.responseStatus}, ${entry.success}, ${entry.durationMs}, ${entry.errorMessage}, 'v3_to_v2')
    `;
  } catch {
    // 日志写入失败不影响主流程
  }
}

interface CallResult {
  data: unknown;
  requestId: string;
  durationMs: number;
}

/**
 * 调用 V2 接口：带超时（AbortController）、重试、Request ID、写 sync_logs
 */
async function callV2(
  apiName: string,
  path: string,
  paramsSummary: string,
  method = "GET",
  body?: unknown
): Promise<CallResult> {
  const requestId = genRequestId();
  const start = Date.now();
  const timeoutMs = (await getConfigNumber("v2_api_timeout_ms")) || 8000;
  const retry = (await getConfigNumber("v2_api_retry")) || 2;

  if (!BASE || !API_KEY) {
    await writeLog({
      requestId, apiName, paramsSummary, responseStatus: 0, success: false,
      durationMs: 0, errorMessage: "V2_API_BASE_URL/V2_API_KEY 未配置",
    });
    throw new Error("V2 接口未配置");
  }

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retry; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        signal: controller.signal,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const data = await res.json().catch(() => ({}));
      await writeLog({
        requestId, apiName, paramsSummary, responseStatus: res.status, success: res.ok,
        durationMs, errorMessage: res.ok ? null : ((data as { error?: string }).error || `HTTP ${res.status}`),
      });
      if (!res.ok) {
        throw new Error(`V2 接口返回 ${res.status}: ${(data as { error?: string }).error || ""}`);
      }
      return { data, requestId, durationMs };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e as Error;
      if (attempt === retry) {
        const durationMs = Date.now() - start;
        const isTimeout = (e as Error).name === "AbortError";
        await writeLog({
          requestId, apiName, paramsSummary, responseStatus: 0, success: false,
          durationMs, errorMessage: isTimeout ? `超时(${timeoutMs}ms)` : (e as Error).message,
        });
      }
    }
  }
  throw lastErr!;
}

// ====== 本地快照维护 ======
async function upsertSnapshot(wb: {
  externalCode: string | null;
  storeName: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  skuCount?: number | null;
  totalQuantity?: string | null;
}, skus: unknown[], source: string): Promise<void> {
  if (!wb.externalCode) return;
  const rawJson = JSON.stringify({ waybill: wb, skus });
  await sql`DELETE FROM v3_waybill_snapshots WHERE waybill_code = ${wb.externalCode}`;
  await sql`
    INSERT INTO v3_waybill_snapshots (waybill_code, store_name, receiver_name, receiver_phone, receiver_address, sku_count, total_quantity, amount, synced_at, sync_source, raw_json)
    VALUES (${wb.externalCode}, ${wb.storeName}, ${wb.receiverName}, ${wb.receiverPhone}, ${wb.receiverAddress}, ${wb.skuCount ?? 0}, ${wb.totalQuantity ?? "0"}, ${0}, now(), ${source}, ${rawJson}::jsonb)
  `;
}

async function getSnapshot(code: string) {
  const rows = await sql`SELECT * FROM v3_waybill_snapshots WHERE waybill_code = ${code}`;
  return rows[0] || null;
}

// ====== 公开能力 ======
export interface WaybillDetail {
  exists: boolean;
  waybill: {
    externalCode: string | null;
    storeName: string | null;
    receiverName: string | null;
    receiverPhone: string | null;
    receiverAddress: string | null;
    skuCount?: number | null;
    totalQuantity?: string | null;
  } | null;
  skus: { skuCode: string; skuName: string; skuQuantity: string; skuSpec: string | null }[];
  fetchedAt?: string;
}

export interface FetchResult {
  data: WaybillDetail | null;
  source: "realtime" | "fallback";
  requestId?: string;
  error?: string;
}

/**
 * 校验运单存在 + 获取详情（发起异常上报时的实时校验走此）
 * V2 不可用时降级到本地快照（标注 fallback）
 */
export async function fetchWaybillByCode(
  code: string,
  opts?: { allowCache?: boolean }
): Promise<FetchResult> {
  try {
    const { data, requestId } = await callV2(
      "GET /api/external/waybills/:code",
      `/api/external/waybills/${encodeURIComponent(code)}`,
      `code=${code}`
    );
    const detail = data as WaybillDetail;
    if (detail.exists && detail.waybill) {
      await upsertSnapshot(detail.waybill, detail.skus, "realtime");
    }
    return { data: detail, source: "realtime", requestId };
  } catch (e) {
    if (opts?.allowCache) {
      const snap = await getSnapshot(code);
      if (snap) {
        return {
          data: {
            exists: true,
            waybill: {
              externalCode: snap.waybill_code,
              storeName: snap.store_name,
              receiverName: snap.receiver_name,
              receiverPhone: snap.receiver_phone,
              receiverAddress: snap.receiver_address,
              skuCount: snap.sku_count,
              totalQuantity: snap.total_quantity,
            },
            skus: [],
          },
          source: "fallback",
          error: (e as Error).message,
        };
      }
    }
    return { data: null, source: "fallback", error: (e as Error).message };
  }
}

/** 校验 SKU 是否归属于指定运单（扫描录入时用） */
export async function checkSkuBelong(
  code: string,
  skuCode: string
): Promise<{ belongs: boolean; requestId?: string; error?: string }> {
  try {
    const { data, requestId } = await callV2(
      "GET /api/external/waybills/:code/skus",
      `/api/external/waybills/${encodeURIComponent(code)}/skus?skuCode=${encodeURIComponent(skuCode)}`,
      `code=${code},skuCode=${skuCode}`
    );
    return { belongs: (data as { belongs: boolean }).belongs, requestId };
  } catch (e) {
    return { belongs: false, error: (e as Error).message };
  }
}

/** 列表同步（初始化/增量同步本地快照） */
export async function listWaybills(page = 1, pageSize = 20) {
  const { data } = await callV2(
    "GET /api/external/waybills",
    `/api/external/waybills?page=${page}&pageSize=${pageSize}`,
    `page=${page},pageSize=${pageSize}`
  );
  return data as { rows: unknown[]; total: number; page: number; pageSize: number };
}

/** 异常标记回写 V2（加分项，失败不阻塞主流程） */
export async function flagWaybill(
  code: string,
  ticketId: string,
  ticketNo: string,
  reason: string
): Promise<boolean> {
  try {
    await callV2(
      "POST /api/external/waybills/:code/flag",
      `/api/external/waybills/${encodeURIComponent(code)}/flag`,
      `code=${code}`,
      "POST",
      { ticketId, ticketNo, reason }
    );
    return true;
  } catch {
    return false;
  }
}

/** 清除异常标记（工单关闭时） */
export async function unflagWaybill(code: string): Promise<boolean> {
  try {
    await callV2(
      "DELETE /api/external/waybills/:code/flag",
      `/api/external/waybills/${encodeURIComponent(code)}/flag`,
      `code=${code}`,
      "DELETE"
    );
    return true;
  } catch {
    return false;
  }
}
