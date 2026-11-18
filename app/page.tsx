"use client";

import { FormEvent, useState } from "react";
import type { ExceptionRow, MappingRow, TypeSummary } from "@/core/types";

interface ApiResult {
  fileName: string;
  title: string;
  xlsxBase64: string;
  totals: { amount: number; fees: number; net: number };
  typeSummary: TypeSummary[];
  transfersTotal: number;
  cogs: number;
  cogsSource: "user" | "transfers-rounded";
  mapping: MappingRow[];
  vtexOnly: { orderId: string; customer: string; paymentValue: number | null }[];
  exceptions: ExceptionRow[];
}

const fmt = (c: number | null) =>
  c === null ? "" : (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function download(r: ApiResult) {
  const bytes = Uint8Array.from(atob(r.xlsxBase64), (ch) => ch.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = r.fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/reconcile", { method: "POST", body: new FormData(e.currentTarget) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      setResult(body as ApiResult);
      download(body as ApiResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const counts = result
    ? result.mapping.reduce<Record<string, number>>((a, m) => ((a[m.matchStatus] = (a[m.matchStatus] ?? 0) + 1), a), {})
    : {};

  return (
    <main>
      <h1>Stripe Payout Reconciliation</h1>
      <p className="sub">Upload the Stripe and VTEX CSVs. The payout workbook downloads when processing finishes.</p>

      <form onSubmit={onSubmit}>
        <label>
          Stripe CSV
          <input type="file" name="stripe" accept=".csv,text/csv" required />
        </label>
        <label>
          VTEX CSV
          <input type="file" name="vtex" accept=".csv,text/csv" required />
        </label>
        <label>
          Payout date
          <input type="date" name="payoutDate" required />
        </label>
        <label>
          COGS inc GST <small>(optional; defaults to transfers rounded)</small>
          <input type="text" name="cogs" inputMode="decimal" placeholder="e.g. 5349.00" />
        </label>
        <div>
          <button type="submit" disabled={busy}>{busy ? "Processing..." : "Generate payout file"}</button>
        </div>
      </form>

      {error && <div className="error" role="alert">{error}</div>}

      {result && (
        <>
          <h2>{result.title}</h2>
          <div className="cards">
            <div className="card"><b>{fmt(result.totals.net)}</b><span>Payout (net)</span></div>
            <div className="card"><b>{fmt(result.totals.amount)}</b><span>Amount</span></div>
            <div className="card"><b>{fmt(result.totals.fees)}</b><span>Stripe fees</span></div>
            <div className="card"><b>{fmt(result.transfersTotal)}</b><span>Seller transfers</span></div>
            <div className="card">
              <b>{fmt(result.cogs)}</b>
              <span>COGS ({result.cogsSource === "user" ? "entered" : "suggested from transfers"})</span>
            </div>
            <div className="card"><b>{result.exceptions.length}</b><span>Exceptions</span></div>
          </div>
          <button className="secondary" onClick={() => download(result)}>Download again</button>

          <h2>Match status</h2>
          <div className="cards">
            {Object.entries(counts).map(([k, v]) => (
              <div className="card" key={k}><b>{v}</b><span>{k}</span></div>
            ))}
            {result.vtexOnly.length > 0 && <div className="card"><b>{result.vtexOnly.length}</b><span>VTEX_ONLY</span></div>}
          </div>

          <h2>Order mapping</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th><th>Order</th><th>Status</th><th>Stripe</th><th>VTEX</th><th>Variance</th>
                  <th>Customer</th><th>Name</th><th>Item</th><th>Shipping</th><th>Final</th><th>Note</th>
                </tr>
              </thead>
              <tbody>
                {result.mapping.map((m, i) => (
                  <tr key={m.stripeId + i}>
                    <td>{m.stripeType}</td>
                    <td>{m.orderId ?? ""}</td>
                    <td className={`st-${m.matchStatus}`}>{m.matchStatus}</td>
                    <td className="num">{fmt(m.stripeAmount)}</td>
                    <td className="num">{fmt(m.vtexPaymentValue)}</td>
                    <td className="num">{fmt(m.variance)}</td>
                    <td>{m.customerStripe || m.customerVtex}</td>
                    <td>{m.name}</td>
                    <td className="num">{fmt(m.item)}</td>
                    <td className="num">{fmt(m.shipping)}</td>
                    <td className="num">{fmt(m.final)}</td>
                    <td>{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Exceptions</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Kind</th><th>Reference</th><th>Detail</th></tr></thead>
              <tbody>
                {result.exceptions.map((x, i) => (
                  <tr key={i}><td>{x.kind}</td><td>{x.reference}</td><td>{x.detail}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
