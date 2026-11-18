import Papa from "papaparse";
import type { StripeRow } from "./types";
import { parseCents, parseStripeDate } from "./util";

const REQUIRED = ["Type", "ID", "Created", "Description", "Amount", "Fees", "Net"];

// Order ids are 10+ digits and must not be followed by more id characters
// (so "Order : 1FCCF1DA..." from card validations is not an order id).
const ORDER_RE = /Order\s*:\s*(\d{10,})(?![0-9A-Za-z])/i;
const SELLER_RE = /Seller\s*:\s*([^,]+)/i;

export function parseStripe(csvText: string): { rows: StripeRow[]; errors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(csvText.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: true,
  });
  const errors: string[] = [];
  const fields = parsed.meta.fields ?? [];
  const missing = REQUIRED.filter((f) => !fields.includes(f));
  if (missing.length) {
    return { rows: [], errors: [`Stripe file is missing column(s): ${missing.join(", ")}`] };
  }

  const rows: StripeRow[] = [];
  parsed.data.forEach((r, i) => {
    const line = i + 1;
    const created = parseStripeDate(r["Created"] ?? "");
    const amount = parseCents(r["Amount"]);
    const fees = parseCents(r["Fees"] === "" ? "0" : r["Fees"]);
    const net = parseCents(r["Net"]);
    if (!created || amount === null || fees === null || net === null) {
      errors.push(`Stripe row ${line} (${r["ID"] ?? "?"}): invalid date or amount`);
      return;
    }
    const description = r["Description"] ?? "";
    rows.push({
      line,
      id: r["ID"],
      type: r["Type"],
      created,
      description,
      amount,
      fees,
      net,
      currency: (r["Currency"] ?? "").toLowerCase(),
      customerName: r["Customer Name"] ?? "",
      orderId: ORDER_RE.exec(description)?.[1] ?? null,
      sellerName: SELLER_RE.exec(description)?.[1].trim().toLowerCase() ?? null,
    });
  });
  return { rows, errors };
}
