import { DEFAULT_BUSINESS_MAPPINGS, GST_RATE_PERCENT } from "./businessMappings";
import { parseStripe } from "./parseStripe";
import { parseVtex } from "./parseVtex";
import type {
  BusinessMapping,
  Cents,
  ExceptionRow,
  MappingRow,
  PayoutRow,
  ReconcileResult,
  StripeRow,
  TypeSummary,
  VtexOrder,
} from "./types";
import { money, payoutDateLabel } from "./util";

export interface ReconcileInput {
  stripeCsv: string;
  vtexCsv: string;
  payoutDate: string; // yyyy-mm-dd, entered by the user
  cogs?: Cents | null; // accounting input; if absent we suggest the rounded transfers total
  mappings?: BusinessMapping[];
}

const TYPE_ORDER = ["Charge", "Refund", "Adjustment", "Transfer", "Stripe Fee"];
const TYPE_LABELS: Record<string, string> = {
  Charge: "Charges",
  Refund: "Refunds",
  Adjustment: "Adjustments",
  Transfer: "Transfers",
  "Stripe Fee": "Stripe fees",
};
const TOLERANCE: Cents = 1; // 0.01

export class InputError extends Error {}

/** (item + shipping) * (1 + GST), rounded half up to cents, in integer maths. */
export function withGst(itemPlusShipping: Cents): Cents {
  return Math.round((itemPlusShipping * (100 + GST_RATE_PERCENT)) / 100);
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const mappings = (input.mappings ?? DEFAULT_BUSINESS_MAPPINGS).filter((m) => m.active);
  const nameBySeller = new Map(mappings.map((m) => [m.seller, m.name]));

  const stripe = parseStripe(input.stripeCsv);
  const vtex = parseVtex(input.vtexCsv);
  const fatal = [...stripe.errors, ...vtex.errors];
  if (fatal.length || stripe.rows.length === 0) {
    throw new InputError(fatal.length ? fatal.join(" | ") : "Stripe file has no rows");
  }
  const label = payoutDateLabel(input.payoutDate);

  const exceptions: ExceptionRow[] = [];

  // Currency check
  const currencies = new Set(stripe.rows.map((r) => r.currency).filter(Boolean));
  if (currencies.size > 1) {
    exceptions.push({
      kind: "MIXED_CURRENCY",
      reference: [...currencies].join(", "),
      detail: "Stripe file contains more than one currency; totals mix currencies.",
    });
  }

  // Orders with a Transfer row: those sellers are paid outside this entity and are excluded from Item.
  const transferSellers = new Map<string, Set<string>>();
  for (const r of stripe.rows) {
    if (r.type === "Transfer" && r.orderId && r.sellerName) {
      if (!transferSellers.has(r.orderId)) transferSellers.set(r.orderId, new Set());
      transferSellers.get(r.orderId)!.add(r.sellerName);
    }
  }

  // Duplicate charges on the same order
  const chargeCount = new Map<string, number>();
  for (const r of stripe.rows) {
    if (r.type === "Charge" && r.orderId) chargeCount.set(r.orderId, (chargeCount.get(r.orderId) ?? 0) + 1);
  }
  for (const [o, n] of chargeCount) {
    if (n > 1) exceptions.push({ kind: "DUPLICATE_STRIPE_CHARGE", reference: o, detail: `${n} charges for one order` });
  }

  const rows: PayoutRow[] = stripe.rows
    .map((s) => ({ stripe: s, mapping: mapRow(s, vtex.orders, transferSellers, nameBySeller, exceptions) }))
    .sort((a, b) => typeRank(a.stripe.type) - typeRank(b.stripe.type) || a.stripe.line - b.stripe.line);

  // VTEX orders with no Stripe row at all
  const stripeOrders = new Set(stripe.rows.filter((r) => r.orderId).map((r) => r.orderId!));
  const vtexOnly = [...vtex.orders.values()].filter((o) => !stripeOrders.has(o.orderId));
  for (const o of vtexOnly) {
    exceptions.push({
      kind: "VTEX_ONLY",
      reference: o.orderId,
      detail: `In VTEX (${o.status || "no status"}, ${o.customer}) but no Stripe row in this file`,
    });
  }

  // One exception per malformed VTEX order (not per line)
  const badByOrder = new Map<string, { n: number; first: number }>();
  for (const m of vtex.malformed) {
    const e = badByOrder.get(m.orderId);
    if (e) e.n++;
    else badByOrder.set(m.orderId, { n: 1, first: m.line });
  }
  for (const [o, e] of badByOrder) {
    exceptions.push({
      kind: "MALFORMED_VTEX_ROW",
      reference: o || `line ${e.first}`,
      detail: `${e.n} VTEX line(s) unusable (first at data row ${e.first}): numeric columns hold text or are blank`,
    });
  }

  // Totals and type summary
  const totals = rows.reduce(
    (t, r) => ({ amount: t.amount + r.stripe.amount, fees: t.fees + r.stripe.fees, net: t.net + r.stripe.net }),
    { amount: 0, fees: 0, net: 0 },
  );

  const knownTypes = new Set(TYPE_ORDER);
  const extraTypes = [...new Set(rows.map((r) => r.stripe.type).filter((t) => !knownTypes.has(t)))];
  for (const t of extraTypes) {
    exceptions.push({ kind: "UNKNOWN_STRIPE_TYPE", reference: t, detail: "Included in totals under its own summary line" });
  }
  const typeSummary: TypeSummary[] = [...TYPE_ORDER, ...extraTypes].map((t) => {
    const rs = rows.filter((r) => r.stripe.type === t).map((r) => r.stripe);
    return {
      label: TYPE_LABELS[t] ?? t,
      stripeType: t,
      count: rs.length,
      amount: sum(rs, "amount"),
      fees: sum(rs, "fees"),
      net: sum(rs, "net"),
    };
  });

  // COGS: separate concept from Stripe transfers. Use the user's figure; otherwise suggest the rounded transfers total.
  const transfersTotal = Math.abs(typeSummary.find((t) => t.stripeType === "Transfer")?.net ?? 0);
  const cogsSource = input.cogs == null ? "transfers-rounded" : "user";
  const cogs = input.cogs ?? Math.round(transfersTotal / 100) * 100;
  const cogsDifference = cogs - transfersTotal;
  if (cogsDifference !== 0) {
    exceptions.push({
      kind: "COGS_VS_TRANSFERS",
      reference: "Accounting",
      detail: `COGS ${money(cogs)} differs from Stripe transfers ${money(transfersTotal)} by ${money(cogsDifference)}`,
    });
  }

  const title = `Stripe Payout ${label} ${(totals.net / 100).toFixed(2)}`;
  return {
    payoutDateLabel: label,
    rows,
    totals,
    typeSummary,
    vtexOnly,
    exceptions,
    transfersTotal,
    cogs,
    cogsSource,
    cogsDifference,
    title,
    fileName: `Stripe Payout ${label} $${(totals.net / 100).toFixed(2)}.xlsx`,
  };
}

function typeRank(t: string): number {
  const i = TYPE_ORDER.indexOf(t);
  return i === -1 ? TYPE_ORDER.length : i;
}

function sum(rs: StripeRow[], k: "amount" | "fees" | "net"): Cents {
  return rs.reduce((a, r) => a + r[k], 0);
}

function mapRow(
  s: StripeRow,
  orders: Map<string, VtexOrder>,
  transferSellers: Map<string, Set<string>>,
  nameBySeller: Map<string, string>,
  exceptions: ExceptionRow[],
): MappingRow {
  const base: MappingRow = {
    stripeId: s.id,
    stripeType: s.type,
    orderId: s.orderId,
    matchStatus: "NO_ORDER_ID",
    stripeAmount: s.amount,
    vtexPaymentValue: null,
    variance: null,
    customerStripe: s.customerName,
    customerVtex: "",
    name: "",
    item: null,
    shipping: null,
    final: null,
    note: "",
  };

  if (!s.orderId) return base;

  if (s.type === "Transfer") {
    return { ...base, matchStatus: "TRANSFER_LINKED", note: `Seller transfer${s.sellerName ? ` to ${s.sellerName}` : ""}` };
  }
  if (s.type !== "Charge") {
    return { ...base, note: "Non-charge row with an order id" };
  }

  const order = orders.get(s.orderId);
  if (!order) {
    exceptions.push({ kind: "STRIPE_ONLY", reference: s.orderId, detail: `Charge ${money(s.amount)} has no VTEX order` });
    return { ...base, matchStatus: "STRIPE_ONLY", note: "No matching VTEX order" };
  }

  base.customerVtex = order.customer;
  base.vtexPaymentValue = order.paymentValue;
  base.variance = order.paymentValue === null ? null : s.amount - order.paymentValue;

  // Item / Shipping: sellers without a transfer on this order.
  const excluded = transferSellers.get(s.orderId) ?? new Set<string>();
  const included = [...order.sellers.values()].filter((g) => !excluded.has(g.seller));
  if (included.length) {
    base.item = included.reduce((a, g) => a + g.item, 0);
    base.shipping = included.reduce((a, g) => a + g.shipping, 0);
    base.final = withGst(base.item + base.shipping);
    // Whole order belongs to this entity: the amount actually charged is authoritative.
    // This also avoids half-cent rounding differences (e.g. 893.475 vs 893.47).
    if (excluded.size === 0 && Math.abs(base.final - s.amount) <= TOLERANCE) base.final = s.amount;

    const names = new Set<string>();
    for (const g of included) {
      const n = nameBySeller.get(g.seller);
      if (n) names.add(n);
      else {
        exceptions.push({
          kind: "UNMAPPED_SELLER",
          reference: s.orderId,
          detail: `Seller "${g.seller || "(blank)"}" has no business mapping`,
        });
      }
    }
    base.name = [...names].join(" + ");
    if (names.size > 1) {
      exceptions.push({ kind: "MULTIPLE_NAMES", reference: s.orderId, detail: `Order maps to ${base.name}` });
    }
  } else if (order.validLines > 0) {
    base.note = "All sellers on this order are paid by transfer";
  }

  // Match status
  if (order.paymentValue === null) {
    base.matchStatus = "AMOUNT_UNVERIFIED";
    base.note = "No usable VTEX lines";
  } else if (Math.abs(base.variance!) > TOLERANCE) {
    base.matchStatus = "AMOUNT_MISMATCH";
    exceptions.push({
      kind: "AMOUNT_MISMATCH",
      reference: s.orderId,
      detail: `Stripe ${money(s.amount)} vs VTEX ${money(order.paymentValue)} (variance ${money(base.variance!)})`,
    });
  } else if (order.malformedLines > 0) {
    base.matchStatus = "AMOUNT_UNVERIFIED";
    base.note = `${order.malformedLines} unusable VTEX line(s); Item/Shipping/Final may be understated`;
  } else {
    base.matchStatus = "MATCHED";
  }
  return base;
}
