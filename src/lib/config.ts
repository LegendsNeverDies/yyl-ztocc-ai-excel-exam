import { sql } from "@/lib/db";
import { CONFIG_DEFAULTS } from "@/types";

// 内存缓存（60s TTL），避免每次 getConfig 都查库
const cache = new Map<string, { value: string; ts: number }>();
const TTL = 60_000;

export async function getConfig(key: string): Promise<string> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.ts < TTL) return cached.value;
  try {
    const rows = await sql`SELECT value FROM v3_config WHERE key = ${key}`;
    if (rows.length > 0) {
      cache.set(key, { value: rows[0].value as string, ts: now });
      return rows[0].value as string;
    }
  } catch {
    // 查询失败走默认
  }
  const def = CONFIG_DEFAULTS[key] ?? "";
  cache.set(key, { value: def, ts: now });
  return def;
}

export async function getConfigNumber(key: string): Promise<number> {
  const v = await getConfig(key);
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export async function setConfig(
  key: string,
  value: string,
  category: string,
  description?: string
): Promise<void> {
  await sql`
    INSERT INTO v3_config (key, value, category, description, updated_at)
    VALUES (${key}, ${value}, ${category}, ${description ?? null}, now())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      category = EXCLUDED.category,
      description = EXCLUDED.description,
      updated_at = now()
  `;
  cache.delete(key);
}

export async function getAllConfig(): Promise<
  { key: string; value: string; category: string; description: string | null }[]
> {
  const rows = await sql`SELECT key, value, category, description FROM v3_config ORDER BY category, key`;
  return rows as { key: string; value: string; category: string; description: string | null }[];
}

// 清除缓存（配置变更后调用）
export function clearConfigCache() {
  cache.clear();
}
