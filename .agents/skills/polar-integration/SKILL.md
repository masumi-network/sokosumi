---
name: polar-integration
description: Add Polar billing to a TypeScript/JavaScript app using the @polar-sh/sdk package. Use this skill whenever the user wants to add a Checkout endpoint, a Customer Portal endpoint, or a Webhooks endpoint for Polar to any framework — Next.js, Express, Hono, Astro, SvelteKit, Remix, TanStack Start, Nuxt, Fastify, Elysia, Deno, Supabase Edge Functions, Cloudflare Workers, Bun, etc.
---

# Polar SDK integration

A standalone guide to wiring up Polar's three core HTTP endpoints — Checkout, Customer Portal, and Webhooks — using `@polar-sh/sdk` directly. The recipes are framework-agnostic Web Standards (`Request`/`Response`); each section also lists the small idiomatic adjustments per framework.

## Setup

Install the SDK. Version 1.0 and later needs Node.js 22 or newer:

```bash
npm install @polar-sh/sdk
# or pnpm / yarn / bun
```

If the project already uses `@polar-sh/sdk` below 1.0 (signs: `new Polar(...)`, camelCase fields such as `successUrl`, imports from `@polar-sh/sdk/webhooks`), upgrade it first by following the [migration guide](https://github.com/polarsource/polar/blob/main/sdk/typescript/.agents/skills/polar-typescript-sdk/references/migration-from-v0.md). Don't mix the old and new conventions.

Don't install the deprecated `@polar-sh/<framework>` adapters (`@polar-sh/express`, `@polar-sh/hono`, `@polar-sh/fastify`, `@polar-sh/elysia`, `@polar-sh/astro`, `@polar-sh/sveltekit`, `@polar-sh/remix`, `@polar-sh/deno`, `@polar-sh/supabase`). `@polar-sh/nextjs`, `@polar-sh/nuxt`, `@polar-sh/tanstack-start` and `@polar-sh/better-auth` are maintained; keep them if the project already uses them.

Required environment variables (use whatever loader your framework provides — `process.env`, `Deno.env`, `import.meta.env`, etc.):

- `POLAR_ACCESS_TOKEN` — organization access token. Create it with the Polar CLI (`polar auth token --scope checkouts:write --scope customer_sessions:write`, which opens a browser and prints the token, so ask the user to run it and save the output to the env file) or in the Polar dashboard (Settings → Access Tokens).
- `POLAR_WEBHOOK_SECRET` — only needed for the webhook recipe.
- `POLAR_ENVIRONMENT` — `sandbox` while developing; omit it or set `production` in production. Sandbox and production are separate, so each needs its own token.

The SDK is versioned by API version: the import path pins it. Use `2026-10`, the current version, unless the project already imports another one. Construct one client in a server-only module and reuse it:

```ts
import { createPolar, type Environment } from "@polar-sh/sdk/2026-10";

const accessToken = process.env.POLAR_ACCESS_TOKEN;
if (!accessToken) throw new Error("POLAR_ACCESS_TOKEN is required");

export const polar = createPolar({
  accessToken,
  environment: (process.env.POLAR_ENVIRONMENT as Environment | undefined) || "production",
});
```

The recipes below import this `polar` client. They are independent — implement only the ones the user asks for.

### Conventions

- Service and method names are camelCase (`polar.checkouts.create`, `polar.customerSessions.create`); every request and response field is `snake_case`, exactly as in the HTTP API.
- Path parameters are positional (`polar.checkouts.get(id)`), request bodies are a single object.
- Paginated lists come from `iter*` methods consumed with `for await`.

---

## Recipe 1 — Checkout endpoint

**Goal:** an HTTP endpoint that creates a Polar checkout session and 302-redirects the browser to the hosted checkout page.

**Underlying API:** `POST /v1/checkouts/` (SDK: `polar.checkouts.create(...)`). Full schema: <https://polar.sh/docs/api-reference/current/checkouts/create-checkout-session>.

### `polar.checkouts.create()` field reference

| Field | Required | Notes |
|---|---|---|
| `products` | yes | Array of product UUIDs. The first is selected by default. |
| `customer_id` | no | Existing Polar customer ID. |
| `external_customer_id` | no | Your own user ID. If no Polar customer matches, one is created with this external ID. |
| `customer_email` | no | |
| `customer_name` | no | |
| `customer_billing_name` | no | |
| `customer_billing_address` | no | `{ country: "US", line1, line2, city, state, postal_code }`. `country` (ISO alpha-2) is required if address is set. |
| `customer_tax_id` | no | |
| `customer_ip_address` | no | Used to pick the presentment currency. |
| `customer_metadata` | no | Copied to the created customer. |
| `is_business_customer` | no | Default `false`. If `true`, full billing address + name required. |
| `metadata` | no | Copied to the resulting order/subscription. |
| `custom_field_data` | no | Map of custom field slug → value. |
| `discount_id` | no | |
| `allow_discount_codes` | no | Default `true`. |
| `require_billing_address` | no | Default `false`. US customers always required regardless. |
| `seats` | no | Predefined number of seats (seat-based pricing only). |
| `min_seats` / `max_seats` | no | Seat-based pricing only. |
| `units` / `min_units` / `max_units` | no | Unit-based pricing only. |
| `amount` | no | Cents. Only used for `custom` (pay-what-you-want) prices. |
| `subscription_id` | no | Upgrade an existing free subscription. |
| `success_url` | no | See below. |
| `return_url` | no | Back-button URL on the checkout page. |
| `embed_origin` | no | Set when embedding the checkout in an iframe. |
| `locale` | no | IETF BCP 47 (`en`, `en-US`, `fr-CA`, ...). Defaults to `en`. |
| `currency` | no | ISO 4217 (e.g. `usd`, `eur`). |
| `trial_interval` / `trial_interval_count` | no | Override product trial. |
| `allow_trial` | no | Default `true`. Set `false` to disable an otherwise-configured trial. |
| `prices` | no | Map of product ID → ad-hoc prices (override catalog prices). |

**Response:** `{ id, url, client_secret, expires_at, status, ... }`. Redirect the user to `url`. To embed the checkout in an iframe instead, pass `url` to `PolarEmbedCheckout.create` from `@polar-sh/checkout` and set `embed_origin`. `client_secret` is only for client-side checkout calls and custom checkout UIs.

### Notes on specific fields

- **`success_url` and `{CHECKOUT_ID}`.** Polar performs a literal string substitution: any `{CHECKOUT_ID}` token in the URL is replaced with the actual session ID at redirect time. The official API docs example uses `?checkout_id={CHECKOUT_ID}`; you can use any param name you want. Useful when your success page needs to fetch the session via `polar.checkouts.get(checkoutId)`. Don't treat the redirect as proof of payment — grant access from a verified webhook or customer state.
- **`theme` (UI hint, not an API field).** The hosted checkout UI accepts `?theme=light|dark` in the URL. To apply a theme, append it to `checkout.url` *after* creating the session.
- **Customer IDs come from your auth.** When the user is logged in, set `customer_id` or `external_customer_id` from the server-side session, never from the query string: the ID links the order to that customer.

### Canonical implementation (Web Standards — Request/Response)

```ts
import { polar } from "./polar";

const SUCCESS_URL = "https://example.com/success?checkout_id={CHECKOUT_ID}";
const THEME: "light" | "dark" | undefined = undefined;

export async function handleCheckout(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const products = url.searchParams.getAll("products");

  if (products.length === 0) {
    return Response.json({ error: "Missing products in query params" }, { status: 400 });
  }

  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    undefined;

  try {
    const checkout = await polar.checkouts.create({
      products,
      success_url: SUCCESS_URL,
      external_customer_id: await getUserId(request), // your auth helper, or undefined for guests
      customer_email: url.searchParams.get("customer_email") ?? undefined,
      customer_ip_address: ipAddress,
      discount_id: url.searchParams.get("discount_id") ?? undefined,
    });

    const redirectUrl = new URL(checkout.url);
    if (THEME) redirectUrl.searchParams.set("theme", THEME);

    return Response.redirect(redirectUrl.toString(), 302);
  } catch (error) {
    console.error(error);
    return new Response(null, { status: 500 });
  }
}
```

This handler accepts a GET request with `?products=<product_id>`. Drop fields you don't need and add fields from the table above (`metadata`, `embed_origin`, `locale`, ...) as needed.

### Framework variations

The body of the handler is identical — only the entry point changes:

- **Next.js (App Router):** `app/api/checkout/route.ts`: `export const GET = handleCheckout;`
- **SvelteKit:** `src/routes/api/checkout/+server.ts`: `export const GET = ({ request }) => handleCheckout(request);`
- **Astro:** `src/pages/api/checkout.ts`: `export const GET: APIRoute = ({ request }) => handleCheckout(request);`
- **Remix / React Router:** `export const loader = ({ request }) => handleCheckout(request);`
- **TanStack Start:** `server: { handlers: { GET: ({ request }) => handleCheckout(request) } }` on the route.
- **Hono:** `app.get("/checkout", (c) => handleCheckout(c.req.raw));`
- **Elysia:** `app.get("/checkout", ({ request }) => handleCheckout(request));`
- **Deno / Supabase Edge Functions:** `Deno.serve(handleCheckout);`
- **Bun:** `Bun.serve({ fetch: handleCheckout });`
- **Cloudflare Workers:** `export default { fetch: handleCheckout };` (read secrets from the `env` argument instead of `process.env`).
- **Nuxt (server route):** `server/api/checkout.get.ts` with `defineEventHandler((event) => handleCheckout(toWebRequest(event)))`.
- **Express:**

  ```ts
  app.get("/checkout", async (req, res) => {
    const url = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
    // ... same body using `url.searchParams`, then res.redirect(redirectUrl.toString()) ...
  });
  ```

- **Fastify:**

  ```ts
  fastify.get("/checkout", async (request, reply) => {
    const url = new URL(`${request.protocol}://${request.hostname}${request.url}`);
    // ... same body, then reply.redirect(redirectUrl.toString()) ...
  });
  ```

---

## Recipe 2 — Customer Portal endpoint

**Goal:** an authenticated endpoint that creates a Polar customer session and 302-redirects to the hosted customer portal (subscriptions, invoices, payment methods).

**Underlying API:** `POST /v1/customer-sessions/` (SDK: `polar.customerSessions.create(...)`). Full schema: <https://polar.sh/docs/api-reference/current/customer-sessions/create-customer-session>.

### `polar.customerSessions.create()` field reference

The request body is a union — pass **either** `customer_id` **or** `external_customer_id`, not both.

| Field | Required | Notes |
|---|---|---|
| `customer_id` | one of these two | Existing Polar customer UUID. |
| `external_customer_id` | one of these two | Your own user ID. |
| `return_url` | no | Back-button URL on the portal page. |
| `member_id` | no | Only for orgs with `member_model_enabled`. Polar customer member UUID. Defaults to the owner member for individual customers. |
| `external_member_id` | no | Your member ID, alternative to `member_id`. |

**Response:** `{ id, customer_portal_url, token, expires_at, customer, customer_id, return_url, ... }`. Redirect the user to `customer_portal_url`. `token` and `customer` are useful if you want to render portal data inside your own UI instead of redirecting.

### Canonical implementation

```ts
import { polar } from "./polar";

const RETURN_URL = "https://example.com/account";

export async function handlePortal(request: Request): Promise<Response> {
  const externalCustomerId = await getUserId(request); // your auth helper
  if (!externalCustomerId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const session = await polar.customerSessions.create({
      external_customer_id: externalCustomerId,
      return_url: RETURN_URL,
    });
    return Response.redirect(session.customer_portal_url, 302);
  } catch (error) {
    console.error(error);
    return new Response(null, { status: 500 });
  }
}
```

If you have a Polar customer ID instead of your own user ID, swap `external_customer_id` for `customer_id`. `external_customer_id` is usually what you want — your auth system already knows the user's ID. Never let the caller choose another customer's ID.

### Framework variations

Use the same entry points as Recipe 1. Read auth state however your framework expects (Next.js: `await cookies()` from `next/headers`, Express: `req.user`, Hono: `c.get("user")`, etc.).

---

## Recipe 3 — Webhooks endpoint

**Goal:** receive Polar webhook events, verify the signature, and dispatch to per-event handlers.

**Contract:** POST endpoint at a stable URL configured in the Polar dashboard. Verifies the `webhook-id`, `webhook-timestamp` and `webhook-signature` headers with `webhooks.validateEvent` from the same versioned import as the client. Keep that version equal to the webhook endpoint's API version in the dashboard, so payloads match the SDK's types.

### Canonical implementation

```ts
import { webhooks } from "@polar-sh/sdk/2026-10";

const WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) throw new Error("POLAR_WEBHOOK_SECRET is required");

export async function handleWebhook(request: Request): Promise<Response> {
  const body = await request.text(); // must be the raw body, not parsed JSON
  const headers = {
    "webhook-id": request.headers.get("webhook-id") ?? "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": request.headers.get("webhook-signature") ?? "",
  };

  let event: webhooks.WebhookPayload;
  try {
    event = await webhooks.validateEvent(body, headers, WEBHOOK_SECRET!);
  } catch (error) {
    if (error instanceof webhooks.PolarWebhookVerificationError) {
      return Response.json({ received: false }, { status: 403 });
    }
    if (error instanceof webhooks.PolarWebhookUnknownTypeError) {
      // Signed, but an event type this SDK version doesn't know. Acknowledge it so Polar doesn't retry.
      return Response.json({ received: true }, { status: 202 });
    }
    if (error instanceof webhooks.PolarWebhookError) {
      return Response.json({ received: false }, { status: 400 });
    }
    throw error;
  }

  switch (event.type) {
    case "order.paid":
      // event.data is the Order — fulfill, send receipt, etc.
      break;

    case "subscription.active":
    case "subscription.canceled":
    case "subscription.uncanceled":
    case "subscription.revoked":
      // event.data is the Subscription — flip entitlements in your DB
      break;

    case "benefit_grant.created":
    case "benefit_grant.updated":
    case "benefit_grant.revoked":
      // grant or revoke the user's access to a benefit
      break;

    case "customer.state_changed":
      // event.data is the full customer state — reconcile access from granted_benefits
      break;
  }

  return Response.json({ received: true }, { status: 202 });
}
```

`event` is fully typed — TypeScript narrows `event.data` inside each `case`. Other events include `checkout.created`, `checkout.updated`, `order.created`, `order.updated`, `order.refunded`, `subscription.created`, `subscription.updated`, `refund.created`, `refund.updated`, `product.created`, `product.updated`, `benefit.created`, `benefit.updated`, `customer.created`, `customer.updated`, `customer.deleted` and `organization.updated`. Subscribe the endpoint only to the events you handle.

### Critical details

1. **Use the raw request body** for `validateEvent`. If your framework parsed JSON for you (Express's `express.json()`, Fastify's default body parser), the signature check fails on the re-serialized JSON.
2. **Respond within 2 seconds.** Polar times out after 10 seconds, retries failed deliveries up to 10 times, and disables the endpoint after 10 consecutive failures. Persist or enqueue the event, return 2xx, and do slow work (email, provisioning) in a background job.
3. **Idempotency.** Polar may redeliver. Deduplicate on the `webhook-id` header — it's unique per delivery and reused on retries. Don't dedupe on `event.data.id`: that's the resource ID and is shared across distinct events about the same resource (e.g. `order.created` and `order.paid`).
4. **Keep the route public.** Polar doesn't follow redirects, so a route behind auth middleware that redirects to a login page fails every delivery. The signature is the authentication.

### Test it locally

With the dev server running, forward events with the Polar CLI and send one (setup in `polar-testing`, "Local Webhook Testing"):

```bash
polar webhook listen 3000/api/polar/webhook   # keep it running in the background
polar webhook trigger order.paid              # exits 1 and prints the response when the handler fails
```

Locally, `POLAR_WEBHOOK_SECRET` is the secret from `polar webhook listen --print-secret`.

### Framework variations

Use the same entry points as Recipe 1 with `POST` (Remix: `action`), plus:

- **Next.js Route Handler:** `app/api/polar/webhook/route.ts`: `export const POST = handleWebhook;`. App Router doesn't parse the body, so `request.text()` is correct.
- **Express:** register the webhook route with `express.raw` **before** `app.use(express.json())` or any other body parser; once an earlier parser has consumed the stream, the signed bytes are gone. Pass the `Buffer` straight to `validateEvent`:

  ```ts
  app.post("/polar/webhook", express.raw({ type: "application/json" }), async (req, res, next) => {
    try {
      const event = await webhooks.validateEvent(req.body, {
        "webhook-id": req.header("webhook-id") ?? "",
        "webhook-timestamp": req.header("webhook-timestamp") ?? "",
        "webhook-signature": req.header("webhook-signature") ?? "",
      }, WEBHOOK_SECRET!);
      // ... handle event, catch the error classes as in the canonical handler ...
      res.sendStatus(202);
    } catch (error) {
      next(error);
    }
  });
  app.use(express.json());
  ```

- **Fastify:** register `fastify-raw-body` and set `config: { rawBody: true }` on the route, then pass `request.rawBody`.
- **Hono:** `app.post("/polar/webhook", (c) => handleWebhook(c.req.raw));`
- **Nuxt:** `await readRawBody(event)` from h3 for the body, `getHeader(event, "webhook-id")` for headers.
