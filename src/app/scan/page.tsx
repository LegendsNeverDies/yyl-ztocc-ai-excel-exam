"use client";

import { useState } from "react";
import { scanWaybill } from "@/lib/server-actions";
import { useToast } from "@/components/shared/toast";
import { useRole } from "@/components/shared/role-context";
import { ScanLine, Loader2, CheckCircle, AlertTriangle, Package } from "lucide-react";

export default function ScanPage() {
  const { showToast } = useToast();
  const { hasRole } = useRole();
  const canScan = hasRole("operator", "qc_manager");

  const [form, setForm] = useState({
    waybillCode: "", skuCode: "", batchNo: "", actualQty: 1,
    damageLevel: 0, hasLabelError: false, specDeviationPct: 0, batchAnomaly: false,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ result: "pass" | "fail"; reason: string; ticketNo?: string; duplicated?: boolean } | null>(null);

  const submit = async () => {
    if (!form.waybillCode || !form.skuCode || !form.batchNo) {
      showToast("请填写运单号、SKU、批次号", "error");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await scanWaybill(form);
      setResult(res);
      showToast(res.duplicated ? "已追加扫描记录（幂等）" : res.result === "fail" ? `品控异常，已建单 ${res.ticketNo}` : "品控通过，正常出库", res.result === "fail" ? "info" : "success");
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  if (!canScan) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="card text-center">
          <Package className="mx-auto h-12 w-12 text-[#86909c] opacity-40" />
          <h2 className="mt-3 text-base font-semibold text-[#4e5969]">无扫描权限</h2>
          <p className="mt-1 text-sm text-[#86909c]">仅操作员/品控主管可执行扫描录入。请在右下角切换角色。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[#1d2129]">
          <ScanLine className="h-6 w-6 text-[#0fc6c2]" />扫描品控
        </h1>
        <p className="mt-1 text-sm text-[#86909c]">扫描时实时校验 SKU 归属 V2 运单，品控规则引擎自动判定，异常自动暂扣批次并建单</p>
      </div>

      <div className="card space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#86909c]">运单号 *</label>
            <input className="input-field" value={form.waybillCode} onChange={(e) => setForm({ ...form, waybillCode: e.target.value })} placeholder="V2 运单 externalCode" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#86909c]">SKU 编码 *</label>
            <input className="input-field" value={form.skuCode} onChange={(e) => setForm({ ...form, skuCode: e.target.value })} placeholder="扫描 SKU 编号" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#86909c]">批次号 *</label>
            <input className="input-field" value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })} placeholder="货物批次" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#86909c]">实际数量</label>
            <input type="number" className="input-field" value={form.actualQty} min={0} onChange={(e) => setForm({ ...form, actualQty: Number(e.target.value) })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#86909c]">破损等级(0-5)</label>
            <input type="number" className="input-field" value={form.damageLevel} min={0} max={5} onChange={(e) => setForm({ ...form, damageLevel: Number(e.target.value) })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#86909c]">规格偏差(%)</label>
            <input type="number" className="input-field" value={form.specDeviationPct} min={0} onChange={(e) => setForm({ ...form, specDeviationPct: Number(e.target.value) })} />
          </div>
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm text-[#4e5969]">
            <input type="checkbox" checked={form.hasLabelError} onChange={(e) => setForm({ ...form, hasLabelError: e.target.checked })} />
            标签错误
          </label>
          <label className="flex items-center gap-2 text-sm text-[#4e5969]">
            <input type="checkbox" checked={form.batchAnomaly} onChange={(e) => setForm({ ...form, batchAnomaly: e.target.checked })} />
            批次异常
          </label>
        </div>

        <button onClick={submit} disabled={loading} className="btn-primary w-full gap-2">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" />扫描判定中...</> : <><ScanLine className="h-4 w-4" />提交扫描</>}
        </button>
      </div>

      {result && (
        <div className={`card mt-4 animate-fade-in ${result.result === "fail" ? "border-l-4 border-l-[#cf1322]" : "border-l-4 border-l-[#17c964]"}`}>
          <div className="flex items-start gap-3">
            {result.result === "fail" ? <AlertTriangle className="h-6 w-6 flex-shrink-0 text-[#cf1322]" /> : <CheckCircle className="h-6 w-6 flex-shrink-0 text-[#17c964]" />}
            <div className="flex-1">
              <h3 className="text-base font-semibold text-[#1d2129]">{result.duplicated ? "幂等追加" : result.result === "fail" ? "品控异常 · 已暂扣" : "品控通过 · 正常出库"}</h3>
              <p className="mt-1 text-sm text-[#4e5969]">{result.reason}</p>
              {result.ticketNo && (
                <p className="mt-2 text-xs text-[#0b6e6e]">已创建工单：<strong>{result.ticketNo}</strong>（批次已锁定，进入二级审批）</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
