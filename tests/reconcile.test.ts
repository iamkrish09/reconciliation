import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook } from "../core/exportXlsx";
import { parseStripe } from "../core/parseStripe";
import { parseVtex } from "../core/parseVtex";
import { InputError, reconcile } from "../core/reconcile";
import { parseCents, parseStripeDate, payoutDateLabel } from "../core/util";

const stripeCsv = readFileSync("tests/fixtures/Stripe Test.csv", "utf8");
const vtexCsv = readFileSync("tests/fixtures/VTEX Test.csv", "utf8");
const ref: { description: string; amount: number; fees: number; net: number; name: string; final: number | null; item: number | null; shipping: number | null }[] =
  JSON.parse(readFileSync("tests/fixtures/reference.json", "utf8").replace(/^\uFEFF/, ""));

const result = reconcile({ stripeCsv, vtexCsv, payoutDate: "2026-11-10" });

describe("util", () => {
  it("parses cents exactly", () => {
    expect(parseCents("2394.95")).toBe(239495);
    expect(parseCents("-0.8")).toBe(-80);
    expect(parseCents("1.005")).toBe(101);
    expect(parseCents("/1/27/31/")).toBeNull();
    expect(parseCents("")).toBeNull();
  });
  it("parses dd-MM-yyyy dates and rejects impossible ones", () => {
    expect(parseStripeDate("06-11-2026 13:40")?.toISOString()).toBe("2026-11-06T13:40:00.000Z");
    expect(parseStripeDate("31-02-2026 10:00")).toBeNull();
  });
  it("formats the payout label", () => {
    expect(payoutDateLabel("2026-11-10")).toBe("10th Nov 26");
    expect(payoutDateLabel("2026-11-01")).toBe("1st Nov 26");
    expect(payoutDateLabel("2026-11-12")).toBe("12th Nov 26");
  });
});

describe("parsers", () => {
  it("extracts order ids but not card-validation hex ids", () => {
    const { rows } = parseStripe(stripeCsv);
    expect(rows).toHaveLength(52);
    expect(rows.filter((r) => r.orderId).length).toBe(rows.filter((r) => /Order:\s*\d/.test(r.description)).length);
    expect(rows.find((r) => r.description.startsWith("Card Validation"))!.orderId).toBeNull();
    const t = rows.find((r) => r.type === "Transfer")!;
    expect(t.orderId).toBe("1674420537737");
    expect(t.sellerName).toBe("twofold");
  });
  it("strips the -01 suffix and flags shifted VTEX rows", () => {
    const v = parseVtex(vtexCsv);
    expect(v.orders.has("1674460537743")).toBe(true);
    expect(v.orders.get("1674710537752")!.malformedLines).toBeGreaterThan(0);
    expect(v.malformed.length).toBeGreaterThan(0);
  });
  it("rejects files with the wrong columns", () => {
    expect(() => reconcile({ stripeCsv: vtexCsv, vtexCsv: stripeCsv, payoutDate: "2026-11-10" })).toThrow(InputError);
  });
});

describe("reconciliation vs the reference payout file", () => {
  it("matches the reference totals", () => {
    expect(result.totals).toEqual({ amount: 3847476, fees: 56253, net: 3791223 });
    expect(result.title).toBe("Stripe Payout 10th Nov 26 37912.23");
    expect(result.fileName).toBe("Stripe Payout 10th Nov 26 $37912.23.xlsx");
  });

  it("matches the reference type summary", () => {
    const by = Object.fromEntries(result.typeSummary.map((t) => [t.label, t]));
    expect(by["Charges"]).toMatchObject({ count: 37, amount: 4391578, fees: 56051 + 0, net: 4335527 });
    expect(by["Refunds"]).toMatchObject({ count: 4, amount: -7200, net: -7200 });
    expect(by["Transfers"]).toMatchObject({ count: 8, net: -534881 });
    expect(by["Stripe fees"]).toMatchObject({ count: 3, amount: -2021, fees: 202, net: -2223 });
  });

  it("reproduces Item / Shipping / Final / Name for every order whose VTEX lines are usable", () => {
    const byOrder = new Map(result.rows.filter((r) => r.mapping.orderId && r.stripe.type === "Charge").map((r) => [r.mapping.orderId!, r]));
    let compared = 0;
    for (const r of ref) {
      const m = /^Order:(\d+)$/.exec(r.description);
      if (!m || r.item === null) continue;
      const mine = byOrder.get(m[1])!;
      if (mine.mapping.matchStatus !== "MATCHED") continue; // unusable VTEX lines are covered below
      compared++;
      expect(mine.mapping.item, m[1]).toBe(Math.round(r.item * 100));
      expect(mine.mapping.shipping, m[1]).toBe(Math.round((r.shipping ?? 0) * 100));
      expect(mine.mapping.final, m[1]).toBe(Math.round(r.final! * 100));
      expect(mine.mapping.name, m[1]).toBe(r.name);
    }
    expect(compared).toBeGreaterThanOrEqual(20);
  });

  it("leaves orders paid entirely by transfer without Item/Final", () => {
    const o = result.rows.find((r) => r.mapping.orderId === "1674720537753" && r.stripe.type === "Charge")!;
    expect(o.mapping.item).toBeNull();
    expect(o.mapping.final).toBeNull();
  });

  it("reports malformed VTEX orders instead of guessing", () => {
    const kinds = new Set(result.exceptions.map((e) => e.kind));
    expect(kinds.has("MALFORMED_VTEX_ROW")).toBe(true);
    const bad = result.rows.find((r) => r.mapping.orderId === "1674950537771" && r.stripe.type === "Charge");
    expect(bad?.mapping.matchStatus).toBe("AMOUNT_UNVERIFIED");
    expect(bad?.mapping.item).toBeNull();
  });

  it("never lets the same row appear twice", () => {
    expect(new Set(result.rows.map((r) => r.stripe.id + r.stripe.line)).size).toBe(52);
  });
});

describe("workbook", () => {
  it("contains the reference layout, formulas and a PASS check", async () => {
    const buf = await buildWorkbook(result);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      "Reconciliation", "Transaction Details", "Order Mapping", "Financial Summary", "Accounting Summary", "Exceptions",
    ]);
    const rc = wb.getWorksheet("Reconciliation")!;
    expect(rc.getCell("A2").value).toBe("Stripe Payout 10th Nov 26 37912.23");
    expect(rc.getCell("B4").value).toBe("Order:1674300537736");
    expect(rc.getCell("H4").value).toBe(2394.95);
    // Same cell positions as the reference sheet
    expect((rc.getCell("E56").value as ExcelJS.CellFormulaValue).formula).toBe("SUM(E4:E55)");
    expect((rc.getCell("E56").value as ExcelJS.CellFormulaValue).result).toBeCloseTo(37912.23, 2);
    expect(rc.getCell("H60").value).toBe("Sales Inc GST");
    expect((rc.getCell("G63").value as ExcelJS.CellFormulaValue).result).toBeCloseTo(37912.23, 2);
    expect(rc.getCell("D75").value).toBe("Payouts");
    const fs = wb.getWorksheet("Financial Summary")!;
    const check = fs.getCell("E10").value as ExcelJS.CellFormulaValue;
    expect(check.result).toBe("PASS");
  });
});
