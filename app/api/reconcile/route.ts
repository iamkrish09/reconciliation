import { buildWorkbook } from "@/core/exportXlsx";
import { InputError, reconcile } from "@/core/reconcile";
import { parseCents } from "@/core/util";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Request must be multipart form data.");
  }

  const stripe = form.get("stripe");
  const vtex = form.get("vtex");
  const payoutDate = String(form.get("payoutDate") ?? "");
  const cogsRaw = String(form.get("cogs") ?? "").trim();

  if (!(stripe instanceof File) || !(vtex instanceof File)) return fail("Upload both the Stripe CSV and the VTEX CSV.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payoutDate) || Number.isNaN(Date.parse(payoutDate))) return fail("Enter a valid payout date.");
  if (stripe.size > MAX_BYTES || vtex.size > MAX_BYTES) return fail("Each file must be 10 MB or smaller.", 413);

  let cogs: number | null = null;
  if (cogsRaw !== "") {
    cogs = parseCents(cogsRaw.replace(/,/g, ""));
    if (cogs === null || cogs < 0) return fail("COGS must be a positive number, for example 5349.00.");
  }

  try {
    const result = reconcile({
      stripeCsv: await stripe.text(),
      vtexCsv: await vtex.text(),
      payoutDate,
      cogs,
    });
    const xlsx = await buildWorkbook(result);

    return Response.json({
      fileName: result.fileName,
      title: result.title,
      xlsxBase64: xlsx.toString("base64"),
      totals: result.totals,
      typeSummary: result.typeSummary,
      transfersTotal: result.transfersTotal,
      cogs: result.cogs,
      cogsSource: result.cogsSource,
      mapping: result.rows.map((r) => r.mapping),
      vtexOnly: result.vtexOnly.map((o) => ({ orderId: o.orderId, customer: o.customer, paymentValue: o.paymentValue })),
      exceptions: result.exceptions,
    });
  } catch (e) {
    if (e instanceof InputError) return fail(e.message);
    console.error(e);
    return fail("Unexpected error while reconciling. Check the files and try again.", 500);
  }
}
