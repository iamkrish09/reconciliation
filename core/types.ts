/** All money values are integer cents. */
export type Cents = number;

export interface StripeRow {
  line: number; // 1-based data row in the CSV
  id: string;
  type: string; // Charge | Refund | Transfer | Stripe Fee | ...
  created: Date; // wall-clock components stored as UTC (no timezone shift)
  description: string;
  amount: Cents;
  fees: Cents;
  net: Cents;
  currency: string;
  customerName: string;
  orderId: string | null;
  sellerName: string | null; // for Transfer rows: "Seller: x, Order: y"
}

export interface VtexLine {
  line: number;
  orderId: string; // "-01" suffix removed
  sellerName: string; // "" = own items
  skuTotal: Cents;
  shipping: Cents;
  totalValue: Cents;
  paymentValue: Cents;
  clientName: string;
  status: string;
  paymentSystem: string;
}

export interface MalformedVtexRow {
  line: number;
  orderId: string;
  reason: string;
}

export interface SellerGroup {
  seller: string; // "" = own items
  item: Cents; // sum of SKU Total Price
  shipping: Cents; // sum of line Shipping Value
  lineCount: number;
}

export interface VtexOrder {
  orderId: string;
  paymentValue: Cents | null;
  customer: string;
  status: string;
  paymentSystem: string;
  sellers: Map<string, SellerGroup>;
  malformedLines: number;
  validLines: number;
}

export interface BusinessMapping {
  seller: string; // lower-case VTEX seller name, "" = own items
  name: string; // business name shown in the Name column
  active: boolean;
}

export type MatchStatus =
  | "MATCHED"
  | "AMOUNT_MISMATCH"
  | "AMOUNT_UNVERIFIED"
  | "STRIPE_ONLY"
  | "TRANSFER_LINKED"
  | "NO_ORDER_ID";

export interface MappingRow {
  stripeId: string;
  stripeType: string;
  orderId: string | null;
  matchStatus: MatchStatus;
  stripeAmount: Cents;
  vtexPaymentValue: Cents | null;
  variance: Cents | null;
  customerStripe: string;
  customerVtex: string;
  name: string; // business name ("" when none)
  item: Cents | null;
  shipping: Cents | null;
  final: Cents | null;
  note: string;
}

export interface ExceptionRow {
  kind: string;
  reference: string;
  detail: string;
}

export interface PayoutRow {
  stripe: StripeRow;
  mapping: MappingRow;
}

export interface TypeSummary {
  label: string;
  stripeType: string;
  count: number;
  amount: Cents;
  fees: Cents;
  net: Cents;
}

export interface ReconcileResult {
  payoutDateLabel: string; // e.g. "10th Nov 26"
  rows: PayoutRow[];
  totals: { amount: Cents; fees: Cents; net: Cents };
  typeSummary: TypeSummary[];
  vtexOnly: VtexOrder[];
  exceptions: ExceptionRow[];
  transfersTotal: Cents; // absolute value
  cogs: Cents;
  cogsSource: "user" | "transfers-rounded";
  cogsDifference: Cents; // cogs - |transfers|
  title: string;
  fileName: string;
}
