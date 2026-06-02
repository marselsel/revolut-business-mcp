/**
 * Reference constants for the Revolut Business API. Most tools return the raw
 * JSON object as `structuredContent`; these arrays document the common enum
 * values surfaced in tool input descriptions. They are intentionally NOT used as
 * strict `z.enum` filters (Revolut may accept values not listed here).
 */

/** Common transaction `type` values. */
export const TRANSACTION_TYPES = [
  "atm",
  "card_payment",
  "card_refund",
  "card_chargeback",
  "card_credit",
  "exchange",
  "transfer",
  "loan",
  "fee",
  "refund",
  "topup",
  "topup_return",
  "tax",
  "tax_refund",
] as const;

/** Common transaction `state` values. */
export const TRANSACTION_STATES = ["pending", "completed", "declined", "failed", "reverted"] as const;
