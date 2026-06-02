import type { McpServer } from "skybridge/server";
import type { Config } from "../config.js";
import type { RevolutClient } from "../revolut/client.js";
import { registerAccountTools } from "./accounts.js";
import { registerCardDraftTools, registerCardPaymentTools, registerCardReadTools } from "./cards.js";
import {
  registerCounterpartyDraftTools,
  registerCounterpartyPaymentTools,
  registerCounterpartyReadTools,
} from "./counterparties.js";
import { registerExpenseTools } from "./expenses.js";
import { registerFxPaymentTools, registerFxReadTools } from "./fx.js";
import { registerPaymentDraftTools, registerPaymentMoneyTools, registerPaymentReadTools } from "./payments.js";
import { registerTeamDraftTools, registerTeamReadTools } from "./team.js";
import { registerTransactionTools } from "./transactions.js";
import {
  registerWebhookDraftTools,
  registerWebhookPaymentTools,
  registerWebhookReadTools,
} from "./webhooks.js";

/**
 * Register MCP tools according to the resolved capability tiers. Only enabled
 * tiers are registered — a disabled tool is never advertised to the model.
 */
export function registerTools(server: McpServer, client: RevolutClient, config: Config): void {
  const { capabilities } = config;
  const webhooksBase = config.revolut.webhooksBaseUrl;

  // Read tier — always on.
  registerAccountTools(server, client);
  registerTransactionTools(server, client);
  registerCounterpartyReadTools(server, client);
  registerPaymentReadTools(server, client);
  registerFxReadTools(server, client);
  registerWebhookReadTools(server, client, webhooksBase);
  registerCardReadTools(server, client);
  registerTeamReadTools(server, client);
  registerExpenseTools(server, client);

  // Drafts / safe-writes tier — no money movement (on by default).
  if (capabilities.drafts) {
    registerCounterpartyDraftTools(server, client);
    registerPaymentDraftTools(server, client);
    registerWebhookDraftTools(server, client, webhooksBase);
    registerCardDraftTools(server, client);
    registerTeamDraftTools(server, client);
  }

  // Payments / money-movement + destructive tier — off by default, confirm-gated.
  if (capabilities.payments) {
    registerCounterpartyPaymentTools(server, client);
    registerPaymentMoneyTools(server, client);
    registerFxPaymentTools(server, client);
    registerWebhookPaymentTools(server, client, webhooksBase);
    registerCardPaymentTools(server, client);
  }
}
