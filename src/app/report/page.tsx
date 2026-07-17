"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getWaybillForReport, createTicket } from "@/lib/server-actions";
import { useToast } from "@/components/shared/toast";
import { useRole } from "@/components/shared/role-context";
import { EXCEPTION_META, type ExceptionType } from "@/types";
import { AlertCircle, Loader2, Search, Package, ShieldCheck, ArrowRight } from "lucide-react";

const LOGISTICS_TYPES = (Object.keys(EXCEPTION_META) as ExceptionType[]).filter(
  (t) => EXCEPTION_META[t].category === "logistics"
);

export default function ReportPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { hasRole } = useRole();
  const canReport = hasRole("operator", "qc_manager");

  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [waybill, setWaybill] = useState<{ exists: boolean; waybill: Record<string, unknown> | null; skus: unknown[] } | null>(null);
  const [source, setSource] = useState<"realtime" | "fallback">("realtime");
  const [error, setError] = useState("");

  const [exceptionType, setExceptionType] = useState<ExceptionType>("lost");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(100);
  const [submitting, setSubmitting] = useState(false);

  const checkWaybill = async () => {
    if (!code) { showToast("请输入运单号", "error"); return; }
    setChecking(true);
    setError("");
    setWaybill(null);
    try {
      const res = await getWaybillForReport(code);
      setSource(res.source);
      if (res.notFound) {
        // V2 接口正常，但运单号在 V2 中查不到 → 业务提示（核对运单号）
        setError(`运单 ${code} 在 V2 中不存在，请核对运单号是否正确后重试`);
      } else if (res.error) {
        // V2 真正连不上 / 报错（5xx、超时、鉴权失败等）→ 服务不可用提示
        setError("V2 服务暂时不可用，发起上报需实时校验运单，请稍后重试");
      } else if (!res.data || !res.data.exists) {
        setError(`运单 ${code} 不存在（V2 实时校验）`);
      } else {
        setWaybill(res.data);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    if (!waybill?.exists) { showToast("请先校验运单", "error"); return; }
    setSubmitting(true);
    try {
      const res = await createTicket({ waybillCode: code, exceptionType, description, amount });
      showToast(`已创建工单 ${res.ticketNo}`, "success");
      router.push(`/tickets/${res.ticketId}`);
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!canReport) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="card text-center">
          <Package className="mx-auto h-12 w-12 text-[#86909c] opacity-40" />
          <h2 className="mt-3 text-base font-semibold text-[#4e5969]">无上报权限</h2>
          <p className="mt-1 text-sm text-[#86909c]">仅操作员/品控主管可发起异常上报。请在右下角切换角色。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[#1d2129]">
          <AlertCircle className="h-6 w-6 text-[#0fc6c2]" />异常上报
        </h1>
        <p className="mt-1 text-sm text-[#86909c]">发起上报时实时调用 V2 接口校验运单真实性，不允许对不存在运单上报</p>
      </div>

      {/* 运单校验 */}
      <div className="card mb-4">
        <label className="mb-1.5 block text-xs font-medium text-[#86909c]">运单号（V2 externalCode）</label>
        <div className="flex gap-2">
          <input className="input-field" value={code} onChange={(e) => setCode(e.target.value)} placeholder="输入运单号" onKeyDown={(e) => e.key === "Enter" && checkWaybill()} />
          <button onClick={checkWaybill} disabled={checking} className="btn-primary gap-1.5 whitespace-nowrap">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {checking ? "校验中" : "实时校验"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-[#cf1322]">{error}</p>}
      </div>

      {/* 运单详情 + 来源标注 */}
      {waybill?.exists && waybill.waybill && (
        <div className="card mb-4 animate-fade-in">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[#1d2129]">
              <Package className="h-4 w-4 text-[#0fc6c2]" />运单信息
            </h2>
            <span className={`tag ${source === "realtime" ? "tag-green" : "tag-orange"}`}>
              {source === "realtime" ? "实时获取自 V2" : "本地缓存，可能非最新"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
            <div><span className="text-[#86909c]">运单号：</span>{String(waybill.waybill.externalCode ?? "-")}</div>
            <div><span className="text-[#86909c]">收货门店：</span>{String(waybill.waybill.storeName ?? "-")}</div>
            <div><span className="text-[#86909c]">收件人：</span>{String(waybill.waybill.receiverName ?? "-")}</div>
            <div><span className="text-[#86909c]">电话：</span>{String(waybill.waybill.receiverPhone ?? "-")}</div>
            <div><span className="text-[#86909c]">SKU种类：</span>{String(waybill.waybill.skuCount ?? "-")}</div>
            <div><span className="text-[#86909c]">总数量：</span>{String(waybill.waybill.totalQuantity ?? "-")}</div>
          </div>
        </div>
      )}

      {/* 上报表单 */}
      {waybill?.exists && (
        <div className="card space-y-4 animate-fade-in">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#86909c]">异常类型</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LOGISTICS_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setExceptionType(t)}
                  className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm transition-all ${
                    exceptionType === t ? "border-[#0fc6c2] bg-[#e8fafa] text-[#0b6e6e]" : "border-[#e5e6eb] text-[#4e5969] hover:border-[#b5e8e8]"
                  }`}
                >
                  <ShieldCheck className="h-4 w-4" />
                  {EXCEPTION_META[t].label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#86909c]">异常金额（元，决定审批层级）</label>
              <input type="number" className="input-field" value={amount} min={0} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#86909c]">下游动作预览</label>
              <div className="rounded-md bg-[#f7f8fa] px-3 py-2 text-xs text-[#4e5969]">
                {EXCEPTION_META[exceptionType].label}：见 ASSUMPTIONS.md ④
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#86909c]">异常描述</label>
            <textarea className="input-field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="详细描述异常情况..." />
          </div>
          <button onClick={submit} disabled={submitting} className="btn-primary w-full gap-2">
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />提交中...</> : <><ArrowRight className="h-4 w-4" />提交异常工单</>}
          </button>
        </div>
      )}
    </div>
  );
}
