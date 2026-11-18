import type { Cents } from "./types";

const NUM = /^-?\d+(\.\d+)?$/;

/** Parses a plain decimal string into integer cents. Returns null if not a clean number. */
export function parseCents(raw: string | undefined | null): Cents | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!NUM.test(s)) return null;
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  // round half up on the third decimal
  const round = frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0;
  return (neg ? -1 : 1) * (cents + round);
}

/** Parses "dd-MM-yyyy HH:mm" (Stripe export). Components are kept as UTC so Excel shows them unchanged. */
export function parseStripeDate(raw: string): Date | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi] = m;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi));
  return d.getUTCMonth() === +mm - 1 ? d : null;
}

export function fromCents(c: Cents): number {
  return c / 100;
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-10" -> "10th Nov 26" */
export function payoutDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid payout date: ${iso}`);
  return `${ordinal(+m[3])} ${MONTHS[+m[2] - 1]} ${m[1].slice(2)}`;
}

export function money(c: Cents): string {
  return (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
