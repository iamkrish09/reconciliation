import ExcelJS from "exceljs";
import type { ReconcileResult } from "./types";

const FMT = "#,##0.00;[Red]-#,##0.00";
const DATE_FMT = "dd/mm/yyyy hh:mm";
const BOLD = { bold: true } as const;
const INPUT_FONT = { color: { argb: "FF0000FF" } } as const; // blue = user input

const r2 = (n: number) => Math.round(n * 100) / 100;
const d = (cents: number | null) => (cents === null ? null : cents / 100);

/**
 * Builds the hybrid workbook:
 *  - values:   Transaction Details, Order Mapping, Exceptions, and detail rows of Reconciliation
 *  - formulas: totals, GST/journal block, Financial Summary, Accounting Summary
 */
export async function buildWorkbook(res: ReconcileResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "recon-poc";
  const n = res.rows.length;
  // Create sheets in final tab order.
  const rc = wb.addWorksheet("Reconciliation", { views: [{ state: "frozen", ySplit: 3 }] });
  const td = wb.addWorksheet("Transaction Details");
  const om = wb.addWorksheet("Order Mapping");
  const fs = wb.addWorksheet("Financial Summary");
  const ac = wb.addWorksheet("Accounting Summary");
  const ex = wb.addWorksheet("Exceptions");
  
  
  
  
  
  

  // ---------- Transaction Details (values) ----------
  
  td.addRow(["Stripe ID", "Type", "Created", "Description", "Amount", "Fees", "Net", "Currency", "Customer Name", "Order ID"]).font = BOLD;
  for (const { stripe: s } of res.rows) {
    td.addRow([s.id, s.type, s.created, s.description, s.amount / 100, s.fees / 100, s.net / 100, s.currency, s.customerName, s.orderId ?? ""]);
  }
  td.getColumn(3).numFmt = DATE_FMT;
  for (const c of [5, 6, 7]) td.getColumn(c).numFmt = FMT;
  [34, 12, 18, 52, 12, 10, 12, 9, 22, 18].forEach((w, i) => (td.getColumn(i + 1).width = w));
  td.views = [{ state: "frozen", ySplit: 1 }];
  const tdLast = n + 1;
  const tdType = `'Transaction Details'!$B$2:$B$${tdLast}`;
  const tdRange = (col: string) => `'Transaction Details'!$${col}$2:$${col}$${tdLast}`;

  // ---------- Financial Summary (formulas) ----------
  
  fs.addRow(["Type", "Count", "Amount", "Fees", "Net", "Stripe type"]).font = BOLD;
  res.typeSummary.forEach((t, i) => {
    const row = i + 2;
    fs.addRow([
      t.label,
      { formula: `COUNTIF(${tdType},$F${row})`, result: t.count },
      { formula: `SUMIFS(${tdRange("E")},${tdType},$F${row})`, result: d(t.amount)! },
      { formula: `SUMIFS(${tdRange("F")},${tdType},$F${row})`, result: d(t.fees)! },
      { formula: `SUMIFS(${tdRange("G")},${tdType},$F${row})`, result: d(t.net)! },
      t.stripeType,
    ]);
  });
  const fsFirst = 2;
  const fsLast = res.typeSummary.length + 1;
  const payoutRow = fsLast + 2;
  const sumNet = res.typeSummary.reduce((a, t) => a + t.net, 0);
  // Payout = Charges + Refunds + Adjustments + Transfers + Stripe fees (+ any other types)
  fs.getCell(`A${payoutRow}`).value = "Payout (sum of types)";
  fs.getCell(`E${payoutRow}`).value = {
    formula: Array.from({ length: fsLast - fsFirst + 1 }, (_, i) => `E${fsFirst + i}`).join("+"),
    result: d(sumNet)!,
  };
  fs.getCell(`A${payoutRow + 1}`).value = "Sum of Net in Transaction Details";
  fs.getCell(`E${payoutRow + 1}`).value = { formula: `SUM(${tdRange("G")})`, result: d(res.totals.net)! };
  fs.getCell(`A${payoutRow + 2}`).value = "Check";
  fs.getCell(`E${payoutRow + 2}`).value = {
    formula: `IF(ABS(E${payoutRow}-E${payoutRow + 1})<0.005,"PASS","FAIL")`,
    result: sumNet === res.totals.net ? "PASS" : "FAIL",
  };
  fs.getRow(payoutRow).font = BOLD;
  for (const c of [3, 4, 5]) fs.getColumn(c).numFmt = FMT;
  [34, 8, 14, 12, 14, 14].forEach((w, i) => (fs.getColumn(i + 1).width = w));

  // ---------- Accounting Summary (formulas) ----------
  
  const transfersRow = res.typeSummary.findIndex((t) => t.stripeType === "Transfer") + 2;
  ac.addRow(["Item", "AUD", "Note"]).font = BOLD;
  ac.addRow([
    "Stripe seller transfers (absolute)",
    { formula: `-'Financial Summary'!E${transfersRow}`, result: d(res.transfersTotal)! },
    "Actual Stripe transactions",
  ]);
  const cogsCell = ac.addRow([
    "COGS inc GST (input)",
    d(res.cogs),
    res.cogsSource === "user" ? "Entered by user" : "Not supplied: defaulted to transfers rounded to whole dollars. Confirm the accounting rule.",
  ]);
  cogsCell.getCell(2).font = INPUT_FONT;
  ac.addRow([
    "COGS minus transfers",
    { formula: "B3-B2", result: r2(res.cogs / 100 - res.transfersTotal / 100) },
    "Non-zero is flagged in Exceptions",
  ]);
  ac.addRow([
    "Payout check",
    { formula: `'Financial Summary'!E${payoutRow + 2}`, result: sumNet === res.totals.net ? "PASS" : "FAIL" },
    "Sum of types equals sum of Net",
  ]);
  ac.getColumn(2).numFmt = FMT;
  [38, 16, 80].forEach((w, i) => (ac.getColumn(i + 1).width = w));

  // ---------- Reconciliation (reference layout) ----------
  
  rc.getCell("A2").value = res.title;
  rc.getCell("A2").font = { bold: true, size: 13 };
  rc.getRow(3).values = ["Created", "Description", "Amount", "Fees", "Net", "Customer Name", "Name", "Final", "Item", "Shipping"];
  rc.getRow(3).font = BOLD;
  res.rows.forEach(({ stripe: s, mapping: m }, i) => {
    const row = rc.getRow(4 + i);
    row.values = [s.created, s.description, s.amount / 100, s.fees / 100, s.net / 100, s.customerName, m.name, d(m.final), d(m.item), d(m.shipping)];
  });
  const first = 4;
  const last = 3 + n;
  const T = last + 1; // totals row
  rc.getCell(`C${T}`).value = { formula: `SUM(C${first}:C${last})`, result: d(res.totals.amount)! };
  rc.getCell(`D${T}`).value = { formula: `SUM(D${first}:D${last})`, result: d(res.totals.fees)! };
  rc.getCell(`E${T}`).value = { formula: `SUM(E${first}:E${last})`, result: d(res.totals.net)! };
  rc.getRow(T).font = BOLD;

  // GST / journal block, same cell relationships as the reference sheet
  const total = d(res.totals.amount)!;
  const fees = d(res.totals.fees)!;
  const net = d(res.totals.net)!;
  const cogs = d(res.cogs)!;
  const [R0, R1, R2, R3, R4, R5] = [T + 4, T + 5, T + 6, T + 7, T + 8, T + 9];
  const salesIncGst = r2(total + cogs);
  const bank = r2(salesIncGst - cogs - fees);
  const gstG = r2((bank / 110) * 10);
  const netSale = r2(bank - gstG);
  const feeExGst = r2((-fees / 110) * 100);
  const gstE = r2((net / 110) * 10);
  const gross = r2(net - gstE);
  const salesExGst = r2(gross - feeExGst);

  const set = (addr: string, v: ExcelJS.CellValue) => (rc.getCell(addr).value = v);
  set(`E${R0}`, { formula: `E${R3}-E${R1}`, result: salesExGst });
  set(`F${R0}`, "sales ex gst");
  set(`G${R0}`, { formula: `C${T}+G${R1}`, result: salesIncGst });
  set(`H${R0}`, "Sales Inc GST");
  set(`I${R0}`, 200);
  set(`E${R1}`, { formula: `-D${T}/110*100`, result: feeExGst });
  set(`F${R1}`, "stripe fee ex gst");
  set(`G${R1}`, { formula: "'Accounting Summary'!B3", result: cogs });
  set(`H${R1}`, "COGS inc GST");
  set(`I${R1}`, 310);
  set(`G${R2}`, { formula: `-D${T}`, result: -fees });
  set(`H${R2}`, "Stripe Fee inc GST");
  set(`I${R2}`, 405);
  set(`E${R3}`, { formula: `E${R5}-E${R4}`, result: gross });
  set(`F${R3}`, "gross");
  set(`G${R3}`, { formula: `G${R0}-G${R1}+G${R2}`, result: bank });
  set(`H${R3}`, "bank");
  set(`E${R4}`, { formula: `E${R5}/110*10`, result: gstE });
  set(`F${R4}`, "GST");
  set(`G${R4}`, { formula: `G${R3}/110*10`, result: gstG });
  set(`H${R4}`, "Gst");
  set(`E${R5}`, { formula: `E${T}`, result: net });
  set(`F${R5}`, "Total received");
  set(`G${R5}`, { formula: `G${R3}-G${R4}`, result: netSale });
  set(`H${R5}`, "Net sale");

  // Summary by type, linked to Financial Summary
  let sr = T + 14;
  res.typeSummary.forEach((t, i) => {
    const f = i + 2;
    rc.getRow(sr).values = [
      t.label,
      { formula: `'Financial Summary'!B${f}`, result: t.count },
      { formula: `'Financial Summary'!C${f}`, result: d(t.amount)! },
      { formula: `'Financial Summary'!D${f}`, result: d(t.fees)! },
      { formula: `'Financial Summary'!E${f}`, result: d(t.net)! },
    ];
    sr++;
  });
  set(`D${sr}`, "Payouts");
  set(`E${sr}`, { formula: `'Financial Summary'!E${payoutRow}`, result: d(sumNet)! });
  rc.getCell(`D${sr}`).font = BOLD;
  rc.getCell(`E${sr}`).font = BOLD;

  for (const r of [R0, R1, R2, R3, R4, R5]) rc.getCell(`G${r}`).numFmt = FMT;
  rc.getColumn(1).numFmt = DATE_FMT;
  for (const c of [3, 4, 5, 8, 9, 10, 7]) rc.getColumn(c).numFmt = FMT;
  rc.getColumn(7).numFmt = "General";
  [18, 56, 12, 10, 12, 22, 14, 14, 14, 12].forEach((w, i) => (rc.getColumn(i + 1).width = w));
  rc.getCell("G3").numFmt = "General";
  // Date column format must not apply to the summary labels
  for (let r = T; r <= sr; r++) rc.getCell(`A${r}`).numFmt = "General";

  // ---------- Order Mapping (values) ----------
  
  om.addRow([
    "Stripe ID", "Type", "Order ID", "Match Status", "Stripe Amount", "VTEX Payment Value", "Variance",
    "Customer (Stripe)", "Customer (VTEX)", "Name", "Item", "Shipping", "Final", "Note",
  ]).font = BOLD;
  for (const { mapping: m } of res.rows) {
    const row = om.addRow([
      m.stripeId, m.stripeType, m.orderId ?? "", m.matchStatus, d(m.stripeAmount), d(m.vtexPaymentValue), d(m.variance),
      m.customerStripe, m.customerVtex, m.name, d(m.item), d(m.shipping), d(m.final), m.note,
    ]);
    const color =
      m.matchStatus === "MATCHED" ? "FFE2F0D9" :
      m.matchStatus === "NO_ORDER_ID" || m.matchStatus === "TRANSFER_LINKED" ? null : "FFFCE4D6";
    if (color) row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  }
  for (const v of res.vtexOnly) {
    om.addRow(["", "", v.orderId, "VTEX_ONLY", null, d(v.paymentValue), null, "", v.customer, "", null, null, null, "No Stripe row in this file"]);
  }
  for (const c of [5, 6, 7, 11, 12, 13]) om.getColumn(c).numFmt = FMT;
  [34, 12, 18, 20, 13, 18, 10, 22, 22, 14, 12, 10, 12, 60].forEach((w, i) => (om.getColumn(i + 1).width = w));
  om.views = [{ state: "frozen", ySplit: 1 }];

  // ---------- Exceptions (values) ----------
  
  ex.addRow(["Kind", "Reference", "Detail"]).font = BOLD;
  for (const e of res.exceptions) ex.addRow([e.kind, e.reference, e.detail]);
  [26, 22, 110].forEach((w, i) => (ex.getColumn(i + 1).width = w));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

