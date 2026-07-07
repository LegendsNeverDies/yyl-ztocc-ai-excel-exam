"use client";

import { useEffect, useState, useCallback } from "react";
import { getConfigList, updateConfigItem, getQcRules, saveQcRule, toggleQcRule } from "@/lib/server-actions";
import { useToast } from "@/components/shared/toast";
import { useRole } from "@/components/shared/role-context";
import { Settings, Save, Plus, Power, Loader2, Package } from "lucide-react";

export default function ConfigPage() {
  const { showToast } = useToast();
  const { hasRole } = useRole();
  const canEdit = hasRole("approver1", "approver2", "qc_manager");
  const [configs, setConfigs] = useState<{ key: string; value: string; category: string; description: string | null }[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [rules, setRules] = useState<Record<string, unknown>[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newRule, setNewRule] = useState({ name: "", exceptionSubType: "quantity_diff", triggerType: "quantity_diff", threshold: "5", severity: "medium", autoApprovalLevel: 2 });

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([getConfigList(), getQcRules()]);
      setConfigs(c as never);
      setRules(r.rows as never);
      const ev: Record<string, string> = {};
      (c as { key: string; value: string }[]).forEach((x) => { ev[x.key] = x.value; });
      setEditValues(ev);
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async (key: string, category: string, description?: string | null) => {
    setSaving(key);
    try {
      await updateConfigItem(key, editValues[key], category, description ?? undefined);
      showToast(`${key} 已保存`, "success");
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setSaving(null);
    }
  };

  const toggleRule = async (id: string, active: boolean) => {
    await toggleQcRule(id, active);
    showToast("规则状态已更新", "success");
    await load();
  };

  const addRule = async () => {
    if (!newRule.name) { showToast("请填写规则名称", "error"); return; }
    const cond =
      newRule.triggerType === "quantity_diff" || newRule.triggerType === "spec_deviation"
        ? { threshold_pct: Number(newRule.threshold) }
        : newRule.triggerType === "damage_level"
        ? { min_level: Number(newRule.threshold) }
        : {};
    try {
      await saveQcRule({
        name: newRule.name, exceptionSubType: newRule.exceptionSubType, triggerType: newRule.triggerType,
        triggerCondition: cond, severity: newRule.severity, autoCreateTicket: true, autoApprovalLevel: newRule.autoApprovalLevel, active: true,
      });
      showToast("规则已新增", "success");
      setShowNew(false);
      setNewRule({ name: "", exceptionSubType: "quantity_diff", triggerType: "quantity_diff", threshold: "5", severity: "medium", autoApprovalLevel: 2 });
      await load();
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  // 按 category 分组
  const grouped = configs.reduce<Record<string, typeof configs>>((acc, c) => {
    (acc[c.category] = acc[c.category] || []).push(c);
    return acc;
  }, {});
  const categoryLabels: Record<string, string> = {
    approval: "审批配置",
    timeout: "超时配置",
    sync: "V2 同步配置",
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[#1d2129]"><Settings className="h-6 w-6 text-[#0fc6c2]" />配置中心</h1>
        <p className="mt-1 text-sm text-[#86909c]">审批阈值/超时时长/品控规则均可配置，不硬编码（呼应 V2 规则引擎理念）</p>
      </div>

      {/* 配置项 */}
      <div className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-[#1d2129]">系统配置项</h2>
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} className="card mb-3">
            <h3 className="mb-3 text-sm font-medium text-[#0b6e6e]">{categoryLabels[cat] || cat}</h3>
            <div className="space-y-2">
              {items.map((c) => (
                <div key={c.key} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#1d2129]">{c.key}</div>
                    {c.description && <div className="text-xs text-[#86909c]">{c.description}</div>}
                  </div>
                  <input
                    className="input-field w-40 text-sm"
                    value={editValues[c.key] ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => setEditValues({ ...editValues, [c.key]: e.target.value })}
                  />
                  {canEdit && (
                    <button onClick={() => saveConfig(c.key, c.category, c.description)} disabled={saving === c.key} className="btn-outline gap-1 text-xs whitespace-nowrap">
                      {saving === c.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}保存
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {configs.length === 0 && <div className="card py-8 text-center text-sm text-[#86909c]">暂无配置（请先运行 seed 初始化）</div>}
      </div>

      {/* 品控规则 */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#1d2129]">品控规则引擎</h2>
          {canEdit && <button onClick={() => setShowNew(!showNew)} className="btn-primary gap-1 text-sm"><Plus className="h-4 w-4" />新增规则</button>}
        </div>

        {showNew && (
          <div className="card mb-3 animate-fade-in">
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label className="mb-1 block text-xs text-[#86909c]">规则名称</label><input className="input-field text-sm" value={newRule.name} onChange={(e) => setNewRule({ ...newRule, name: e.target.value })} /></div>
              <div><label className="mb-1 block text-xs text-[#86909c]">异常子类型</label>
                <select className="input-field text-sm" value={newRule.exceptionSubType} onChange={(e) => setNewRule({ ...newRule, exceptionSubType: e.target.value, triggerType: e.target.value })}>
                  <option value="quantity_diff">数量不符</option><option value="appearance_damage">外观破损</option><option value="spec_mismatch">规格不符</option><option value="label_error">标签错误</option><option value="batch_anomaly">批次异常</option>
                </select>
              </div>
              <div><label className="mb-1 block text-xs text-[#86909c]">触发阈值</label><input className="input-field text-sm" value={newRule.threshold} onChange={(e) => setNewRule({ ...newRule, threshold: e.target.value })} placeholder="数量差异%/破损等级" /></div>
              <div><label className="mb-1 block text-xs text-[#86909c]">严重度</label>
                <select className="input-field text-sm" value={newRule.severity} onChange={(e) => setNewRule({ ...newRule, severity: e.target.value })}>
                  <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
                </select>
              </div>
              <div><label className="mb-1 block text-xs text-[#86909c]">自动审批层级</label>
                <select className="input-field text-sm" value={newRule.autoApprovalLevel} onChange={(e) => setNewRule({ ...newRule, autoApprovalLevel: Number(e.target.value) })}>
                  <option value={1}>一级</option><option value={2}>二级</option>
                </select>
              </div>
              <div className="flex items-end"><button onClick={addRule} className="btn-primary w-full gap-1 text-sm"><Save className="h-4 w-4" />保存规则</button></div>
            </div>
          </div>
        )}

        {rules.length === 0 ? (
          <div className="card py-8 text-center text-sm text-[#86909c]">暂无品控规则（请先运行 seed 初始化）</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {rules.map((r) => (
              <div key={r.id as string} className={`card !p-4 ${r.active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#1d2129]">{r.name as string}</h3>
                  <span className={`tag ${r.severity === "high" ? "tag-red" : r.severity === "medium" ? "tag-orange" : "tag-gray"}`}>{r.severity as string}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-[#86909c]">
                  <span className="tag tag-teal">{r.exception_sub_type as string}</span>
                  <span>{r.trigger_type as string}</span>
                  <span>→ {r.auto_approval_level as number}级审批</span>
                </div>
                <p className="mt-1.5 text-xs text-[#4e5969]">{JSON.stringify(r.trigger_condition)}</p>
                {canEdit && (
                  <button onClick={() => toggleRule(r.id as string, !(r.active as boolean))} className={`mt-2 btn-ghost gap-1 text-xs ${r.active ? "text-[#cf1322]" : "text-[#17c964]"}`}>
                    <Power className="h-3 w-3" />{r.active ? "停用" : "启用"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
