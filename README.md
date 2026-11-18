# recon-poc: Stripe payout reconciliation

Upload a Stripe balance CSV and a VTEX orders CSV, enter the payout date, get back a
`Stripe Payout <date> $<net>.xlsx` workbook.

## Run

```
npm install      # if the project folder is scanned by an IDE/antivirus and npm fails with ENOTEMPTY,
                 # install in a temp folder and copy node_modules across
npm run dev      # http://localhost:3000
npm test         # 13 tests against the sample files in tests/fixtures
```

## How it works

- `core/` is plain TypeScript with no framework imports, so it can move to a CLI, worker or other UI later.
- Money is held as integer cents.
- Match key: Stripe `Description` -> `Order:<10+ digits>`; VTEX `Order` with the `-01` suffix removed.
- **Item** = sum of VTEX `SKU Total Price`, grouped by order and seller, excluding sellers that have a
  Stripe Transfer on that order. **Shipping** = sum of `Shipping Value` for the same lines.
  **Final** = (Item + Shipping) x 1.10, or the Stripe amount when the whole order belongs to this entity.
- **Name** comes from `core/businessMappings.ts` (seller -> name). Unknown sellers go to Exceptions.
- VTEX rows whose numeric columns hold text (shifted columns) or are blank are excluded and listed in
  Exceptions; the order is marked `AMOUNT_UNVERIFIED` and Item/Shipping/Final are left empty when no usable line exists.
- COGS is an input. If omitted, the transfers total rounded to whole dollars is suggested and the difference is flagged.

## Workbook sheets

| Sheet | Content |
|---|---|
| Reconciliation | Reference layout: detail A-J, totals, GST/journal block, summary by type |
| Transaction Details | Stripe rows as imported |
| Order Mapping | One row per Stripe line with match status, plus VTEX-only orders |
| Financial Summary | Formulas per Stripe type and the payout PASS/FAIL check |
| Accounting Summary | Transfers, COGS input and difference |
| Exceptions | Everything that needs a human decision |

## Known limits (POC)

- One upload = one payout. No payout id in the export, so the date is typed in.
- Business mapping is hardcoded in a file, not editable in the UI.
- `wakee` maps to INC WAKEE; the reference also uses WAKEE for another order and the deciding rule is unknown.
- Nothing is stored; files are processed in memory.