import { sql } from "@/lib/db";

/**
 * 品控规则引擎 —— 触发条件可配置（v3_qc_rules.trigger_condition JSON），不硬编码
 * 规则执行过程可追溯：命中后记录 ruleId + reason 写入 scan_records
 * 详见 ASSUMPTIONS.md ⑧ 品控规则触发阈值
 */

export interface ScanInput {
  waybillCode: string;
  skuCode: string;
  batchNo: string;
  actualQty: number;
  expectedQty: number;
  damageLevel: number; // 0-5
  hasLabelError: boolean;
  specDeviationPct: number;
  batchAnomaly: boolean;
}

export interface QcEvalResult {
  result: "pass" | "fail";
  ruleId?: string;
  ruleName?: string;
  exceptionSubType?: string;
  severity?: string;
  autoApprovalLevel?: number;
  reason: string;
}

interface QcRuleRow {
  id: string;
  name: string;
  exception_sub_type: string;
  trigger_type: string;
  trigger_condition: unknown;
  severity: string;
  auto_approval_level: number | null;
}

export async function getActiveQcRules(): Promise<QcRuleRow[]> {
  const rows = await sql`
    SELECT id, name, exception_sub_type, trigger_type, trigger_condition, severity, auto_approval_level
    FROM v3_qc_rules WHERE active = true
    ORDER BY severity DESC, created_at
  `;
  return rows as unknown as QcRuleRow[];
}

/** 评估扫描结果，命中第一条规则即返回（fail） */
export async function evaluateScan(input: ScanInput): Promise<QcEvalResult> {
  const rules = await getActiveQcRules();
  for (const rule of rules) {
    const cond = (rule.trigger_condition || {}) as Record<string, number>;
    let hit = false;
    let detail = "";

    switch (rule.trigger_type) {
      case "quantity_diff": {
        const threshold = cond.threshold_pct ?? 5;
        if (input.expectedQty > 0) {
          const diff = (Math.abs(input.actualQty - input.expectedQty) / input.expectedQty) * 100;
          if (diff > threshold) {
            hit = true;
            detail = `数量差异 ${diff.toFixed(1)}% > 阈值 ${threshold}%（实际 ${input.actualQty}/预期 ${input.expectedQty}）`;
          }
        }
        break;
      }
      case "damage_level": {
        const minLevel = cond.min_level ?? 3;
        if (input.damageLevel >= minLevel) {
          hit = true;
          detail = `破损等级 ${input.damageLevel} ≥ 触发等级 ${minLevel}`;
        }
        break;
      }
      case "spec_deviation": {
        const threshold = cond.threshold_pct ?? 10;
        if (input.specDeviationPct > threshold) {
          hit = true;
          detail = `规格偏差 ${input.specDeviationPct}% > 阈值 ${threshold}%`;
        }
        break;
      }
      case "label_error": {
        if (input.hasLabelError) {
          hit = true;
          detail = "存在标签错误";
        }
        break;
      }
      case "batch_anomaly": {
        if (input.batchAnomaly) {
          hit = true;
          detail = "批次异常";
        }
        break;
      }
    }

    if (hit) {
      return {
        result: "fail",
        ruleId: rule.id,
        ruleName: rule.name,
        exceptionSubType: rule.exception_sub_type,
        severity: rule.severity,
        autoApprovalLevel: rule.auto_approval_level ?? 2,
        reason: `命中规则「${rule.name}」：${detail}`,
      };
    }
  }
  return { result: "pass", reason: "未命中任何品控规则，判定通过" };
}
