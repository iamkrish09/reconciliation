import type { BusinessMapping } from "./types";

/**
 * Seller -> business Name lookup. Seller "" means own items (blank Seller Name in VTEX).
 * Inferred from the 10 Nov sample; confirm with the business before relying on it.
 * Unknown sellers are reported in Exceptions, never guessed.
 *
 * Known gap: the reference file shows `wakee` as both "INC WAKEE" and "WAKEE", and
 * "NOVO" next to "INC NOVO". The rule that separates them is not in the CSVs.
 */
export const DEFAULT_BUSINESS_MAPPINGS: BusinessMapping[] = [
  { seller: "", name: "CERES", active: true },
  { seller: "cottonon", name: "CERES", active: true },
  { seller: "novoshoes", name: "INC NOVO", active: true },
  { seller: "etikette", name: "ETIKETTE", active: true },
  { seller: "wakee", name: "INC WAKEE", active: true },
];

export const GST_RATE_PERCENT = 10;
