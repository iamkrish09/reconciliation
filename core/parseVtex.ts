import Papa from "papaparse";
import type { MalformedVtexRow, SellerGroup, VtexLine, VtexOrder } from "./types";
import { parseCents } from "./util";

const REQUIRED = [
  "Order",
  "Client Name",
  "Client Last Name",
  "Status",
  "Payment System Name",
  "Payment Value",
  "Seller Name",
  "SKU Total Price",
  "Shipping Value",
  "Total Value",
];

export function normalizeVtexOrder(raw: string): string {
  return raw.trim().replace(/-\d+$/, "");
}

export function parseVtex(csvText: string): {
  orders: Map<string, VtexOrder>;
  malformed: MalformedVtexRow[];
  errors: string[];
} {
  // header: true keeps everything as text, so long ids are never turned into numbers.
  const parsed = Papa.parse<Record<string, string>>(csvText.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: true,
  });
  const fields = parsed.meta.fields ?? [];
  const missing = REQUIRED.filter((f) => !fields.includes(f));
  if (missing.length) {
    return { orders: new Map(), malformed: [], errors: [`VTEX file is missing column(s): ${missing.join(", ")}`] };
  }

  const orders = new Map<string, VtexOrder>();
  const malformed: MalformedVtexRow[] = [];

  parsed.data.forEach((r, i) => {
    const line = i + 1;
    const orderId = normalizeVtexOrder(r["Order"] ?? "");
    if (!orderId) {
      malformed.push({ line, orderId: "", reason: "Row has no order id" });
      return;
    }

    let order = orders.get(orderId);
    if (!order) {
      order = {
        orderId,
        paymentValue: null,
        customer: "",
        status: "",
        paymentSystem: "",
        sellers: new Map(),
        malformedLines: 0,
        validLines: 0,
      };
      orders.set(orderId, order);
    }

    // A line is usable only if the numeric columns really are numbers. Shifted
    // columns (values in the wrong place) and blank rows fail this check.
    const skuTotal = parseCents(r["SKU Total Price"]);
    const shipping = parseCents(r["Shipping Value"] === "" ? "0" : r["Shipping Value"]);
    const payment = parseCents(r["Payment Value"]);
    const totalValue = parseCents(r["Total Value"]);
    if (skuTotal === null || shipping === null || payment === null || totalValue === null) {
      order.malformedLines++;
      malformed.push({
        line,
        orderId,
        reason: "SKU Total Price / Shipping Value / Payment Value / Total Value is not numeric (row shifted or blank)",
      });
      return;
    }

    const lineObj: VtexLine = {
      line,
      orderId,
      sellerName: (r["Seller Name"] ?? "").trim().toLowerCase(),
      skuTotal,
      shipping,
      totalValue,
      paymentValue: payment,
      clientName: `${r["Client Name"] ?? ""} ${r["Client Last Name"] ?? ""}`.trim(),
      status: r["Status"] ?? "",
      paymentSystem: r["Payment System Name"] ?? "",
    };

    order.validLines++;
    order.paymentValue = lineObj.paymentValue; // same on every line of the order
    order.customer = order.customer || lineObj.clientName;
    order.status = order.status || lineObj.status;
    order.paymentSystem = order.paymentSystem || lineObj.paymentSystem;

    const g: SellerGroup =
      order.sellers.get(lineObj.sellerName) ??
      { seller: lineObj.sellerName, item: 0, shipping: 0, lineCount: 0 };
    g.item += lineObj.skuTotal;
    g.shipping += lineObj.shipping;
    g.lineCount++;
    order.sellers.set(lineObj.sellerName, g);
  });

  return { orders, malformed, errors: [] };
}
