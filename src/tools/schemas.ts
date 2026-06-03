import { z } from "zod";

/**
 * Lenient zod shapes for Revolut write payloads. Revolut's request bodies vary by
 * counterparty/account type and region, so we validate the load-bearing fields and
 * forward the rest untouched (`.passthrough()`). Marked VERIFY where the exact
 * contract should be confirmed against the live API.
 */

/** A payment receiver. VERIFY exact shape against Revolut `POST /pay`. */
export const receiverShape = z
  .object({
    counterparty_id: z.string().describe("Target counterparty id (from list-counterparties)."),
    account_id: z
      .string()
      .optional()
      .describe("The counterparty's account id — required when they have multiple accounts."),
  })
  .passthrough();

/** create-payment (POST /pay) — moves real money. */
export const paymentInputShape = {
  account_id: z.string().describe("Your source account id (from list-accounts)."),
  receiver: receiverShape,
  amount: z.number().positive().describe("Amount to send, in the given currency."),
  currency: z.string().describe('ISO 4217 currency code, e.g. "EUR", "GBP".'),
  reference: z.string().optional().describe("Statement reference shown to the recipient."),
} as const;

/** create-transfer (between your own accounts). VERIFY field names against the API. */
export const transferInputShape = {
  source_account_id: z.string().describe("Account to debit (yours)."),
  target_account_id: z.string().describe("Account to credit (yours)."),
  amount: z.number().positive(),
  currency: z.string().describe("ISO 4217 currency code."),
  reference: z.string().optional(),
} as const;

/** create-exchange (FX) — converts/moves money. Set `amount` on exactly one side. */
export const exchangeInputShape = {
  from: z
    .object({
      account_id: z.string(),
      currency: z.string(),
      amount: z.number().positive().optional().describe("Set on the SELL side (omit on the buy side)."),
    })
    .passthrough(),
  to: z
    .object({
      account_id: z.string(),
      currency: z.string(),
      amount: z.number().positive().optional().describe("Set on the BUY side (omit on the sell side)."),
    })
    .passthrough(),
  reference: z.string().optional(),
  exchange_reason_code: z
    .string()
    .optional()
    .describe("Required in some jurisdictions — see get-exchange-reasons."),
} as const;

/** create-payment-draft (POST /payment-drafts) — needs in-app approval; no money moves. */
export const paymentDraftInputShape = {
  title: z.string().optional().describe("Optional title for the draft batch."),
  schedule_for: z.string().optional().describe("ISO date to schedule the draft (optional)."),
  payments: z
    .array(
      z
        .object({
          account_id: z.string(),
          receiver: receiverShape,
          amount: z.number().positive(),
          currency: z.string(),
          reference: z.string().optional(),
        })
        .passthrough(),
    )
    .min(1)
    .describe("One or more payments in this draft."),
} as const;

/**
 * create-counterparty (POST /counterparties) — lenient. Provide EITHER a Revolut
 * counterparty (profile_type + name/revtag) OR an external bank account
 * (name/company_name + iban[/bic] or account_no+sort_code). VERIFY per region.
 */
export const counterpartyInputShape = {
  profile_type: z
    .enum(["personal", "business"])
    .optional()
    .describe("For a Revolut counterparty: their profile type."),
  name: z.string().optional().describe("Individual counterparty name."),
  company_name: z.string().optional().describe("For a business bank-account counterparty."),
  revtag: z.string().optional().describe("For a Revolut counterparty (their @revtag)."),
  iban: z.string().optional(),
  bic: z.string().optional(),
  account_no: z.string().optional().describe("Local account number (e.g. UK)."),
  sort_code: z.string().optional().describe("UK sort code."),
  bank_country: z.string().optional().describe('ISO country of the counterparty bank, e.g. "GB", "DE" (required for external bank accounts).'),
  currency: z.string().optional(),
} as const;

/** create-webhook (POST /2.0/webhooks). */
export const webhookInputShape = {
  url: z.string().url().describe("HTTPS endpoint that will receive events."),
  events: z
    .array(z.string())
    .optional()
    .describe('Event types, e.g. ["TransactionCreated","TransactionStateChanged"]. Defaults to both.'),
} as const;

/** create-card (virtual). VERIFY required fields against the Cards API. */
export const cardInputShape = {
  request_id: z.string().optional().describe("Idempotency key; generated server-side if omitted."),
  holder_id: z.string().optional().describe("Team member id the card is issued to."),
  label: z.string().optional().describe("Card label/name."),
  accounts: z.array(z.string()).optional().describe("Linked account ids."),
} as const;
