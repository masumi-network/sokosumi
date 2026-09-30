import { z } from "@hono/zod-openapi";

import { ComposioToolError } from "@/clients/social-post-providers/tools";
import {
  type AdsConnectedAccount,
  type AvailableAdAccount,
  type ExecuteAdsTool,
  parseToolRows,
  toolRows,
  withAdsToolSession,
} from "@/lib/ads/composio-tools";

const LIST_ACCESSIBLE_CUSTOMERS = "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS";
const SEARCH_STREAM_GAQL = "GOOGLEADS_SEARCH_STREAM_GAQL";
const MAX_CUSTOMERS = 50;

const CUSTOMER_FIELDS = [
  "id",
  "descriptive_name",
  "currency_code",
  "time_zone",
  "manager",
];
const CUSTOMER_QUERY = `SELECT ${CUSTOMER_FIELDS.map((f) => `customer.${f}`).join(", ")} FROM customer LIMIT 1`;
const CLIENTS_QUERY = `SELECT ${CUSTOMER_FIELDS.map((f) => `customer_client.${f}`).join(", ")} FROM customer_client WHERE customer_client.level > 0 AND customer_client.manager = FALSE AND customer_client.status = 'ENABLED'`;

const googleCustomerSchema = z.object({
  id: z.coerce.string().min(1),
  descriptiveName: z.string().nullish(),
  currencyCode: z.string().min(1),
  timeZone: z.string().nullish(),
  manager: z.boolean().nullish(),
});
const customerRowSchema = z.object({ customer: googleCustomerSchema });
const clientRowSchema = z.object({ customerClient: googleCustomerSchema });

/** Composio may return Google's REST camelCase or the proto snake_case. */
function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      camelizeKeys(item),
    ]),
  );
}

async function gaqlRows(
  execute: ExecuteAdsTool,
  customerId: string,
  query: string,
): Promise<unknown[]> {
  const payload = await execute(SEARCH_STREAM_GAQL, {
    customer_id: customerId,
    query,
  });
  return toolRows(payload, "results").map(camelizeKeys);
}

function toAvailableAccount(
  customer: z.infer<typeof googleCustomerSchema>,
  loginCustomerId: string | null,
): AvailableAdAccount {
  return {
    externalAccountId: customer.id,
    name: customer.descriptiveName?.trim() || `Account ${customer.id}`,
    currency: customer.currencyCode,
    timeZone: customer.timeZone ?? null,
    loginCustomerId,
  };
}

/**
 * Accounts the connected Google user can run campaigns on. A manager account
 * is not listed itself; its client accounts are, reached through it.
 */
export async function listGoogleAdAccounts(
  input: AdsConnectedAccount,
): Promise<AvailableAdAccount[]> {
  return withAdsToolSession(
    {
      ...input,
      provider: "google_ads",
      toolSlugs: [LIST_ACCESSIBLE_CUSTOMERS, SEARCH_STREAM_GAQL],
    },
    async (execute) => {
      const resourceNames = toolRows(
        await execute(LIST_ACCESSIBLE_CUSTOMERS, {}),
        "resource_names",
      );
      const customerIds = resourceNames
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.replace(/^customers\//, ""))
        .slice(0, MAX_CUSTOMERS);

      const perCustomer = await Promise.all(
        customerIds.map(async (customerId) => {
          try {
            const [customer] = parseToolRows(
              await gaqlRows(execute, customerId, CUSTOMER_QUERY),
              customerRowSchema,
              "describe Google Ads customer",
            );
            if (!customer) return [];
            if (!customer.customer.manager) {
              return [toAvailableAccount(customer.customer, null)];
            }
            return parseToolRows(
              await gaqlRows(execute, customerId, CLIENTS_QUERY),
              clientRowSchema,
              "list Google Ads client accounts",
            ).map((row) => toAvailableAccount(row.customerClient, customerId));
          } catch (error) {
            // Google lists customers the user cannot query (cancelled, no access).
            if (error instanceof ComposioToolError) return [];
            throw error;
          }
        }),
      );

      // A client reachable directly keeps direct access over its manager.
      const accounts = new Map<string, AvailableAdAccount>();
      for (const account of perCustomer.flat()) {
        const existing = accounts.get(account.externalAccountId);
        if (!existing || (existing.loginCustomerId && !account.loginCustomerId))
          accounts.set(account.externalAccountId, account);
      }
      return [...accounts.values()];
    },
  );
}
