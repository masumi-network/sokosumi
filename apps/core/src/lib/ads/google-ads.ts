import { z } from "@hono/zod-openapi";

import { ComposioToolError } from "@/clients/social-post-providers/tools";
import {
  type AdsConnectedAccount,
  type AvailableAdAccount,
  parseToolRows,
  toolRows,
  withAdsToolSession,
} from "@/lib/ads/composio-tools";

const LIST_ACCESSIBLE_CUSTOMERS = "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS";
const SEARCH_STREAM_GAQL = "GOOGLEADS_SEARCH_STREAM_GAQL";
const MAX_CUSTOMERS = 50;

const CUSTOMER_QUERY =
  "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1";

const customerRowSchema = z.object({
  customer: z.object({
    id: z.coerce.string().min(1),
    descriptiveName: z.string().nullish(),
    currencyCode: z.string().min(1),
    timeZone: z.string().nullish(),
    manager: z.boolean().nullish(),
  }),
});

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

/**
 * Customer accounts the connected Google user can open directly. Manager
 * accounts are left out: Composio's Google Ads tools have no
 * `login-customer-id`, so their client accounts are out of reach.
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
      const customerIds = toolRows(
        await execute(LIST_ACCESSIBLE_CUSTOMERS, {}),
        "resource_names",
      )
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.replace(/^customers\//, ""))
        .slice(0, MAX_CUSTOMERS);

      const accounts = await Promise.all(
        customerIds.map(async (customerId) => {
          try {
            const rows = toolRows(
              await execute(SEARCH_STREAM_GAQL, {
                customer_id: customerId,
                query: CUSTOMER_QUERY,
              }),
              "results",
            ).map(camelizeKeys);
            const [row] = parseToolRows(
              rows,
              customerRowSchema,
              "describe Google Ads customer",
            );
            const customer = row?.customer;
            if (!customer || customer.manager) return [];
            return [
              {
                externalAccountId: customer.id,
                name:
                  customer.descriptiveName?.trim() || `Account ${customer.id}`,
                currency: customer.currencyCode,
                timeZone: customer.timeZone ?? null,
              },
            ];
          } catch (error) {
            // Google lists customers the user cannot query (cancelled, no access).
            if (error instanceof ComposioToolError) return [];
            throw error;
          }
        }),
      );
      return accounts.flat();
    },
  );
}
