---
name: setup-polar
description: |
  Interactive onboarding wizard to set up Polar payment integration from scratch. Use this skill when: (1) User wants to "set up Polar" or "integrate Polar" in their project; (2) User is starting fresh with Polar and needs guided setup; (3) User asks "how do I get started with Polar"; (4) User wants to add payments/subscriptions/checkout to their app using Polar; (5) User needs help creating their first Polar product and checkout. This skill walks through MCP installation, authentication, product creation, and generates framework-specific integration code.
---

# Polar Setup Wizard

Interactive setup guide to get Polar payments working in your project.

## Setup Flow

Follow these steps in order:

### Step 1: Check MCP Availability

First, check if the Polar MCP server is available by listing organizations: call `execute` with `GET /v1/organizations/`, or `organizations_list` where the server exposes one tool per operation.

**If MCP tools work:** Skip to Step 3.

**If MCP not available:** Continue to Step 2.

### Step 2: Install Polar MCP

**Polar plugin installed:** the plugin already configures the Polar server (`polar`, plus `polar-sandbox` where available). Ask the user to sign in to it, preferring `polar-sandbox`: in Claude Code with `/mcp`, in Codex with `codex mcp login <server>`, in Cursor or Antigravity from their MCP settings, in Gemini CLI with `/mcp auth <server>`, and in ChatGPT when prompted to connect. Then continue with the verification below.

Otherwise, guide the user to install the Polar MCP server based on their environment:

**Claude Code:**
```bash
# Production
claude mcp add --transport http polar https://mcp.polar.sh/mcp/polar-mcp

# Sandbox (recommended for setup)
claude mcp add --transport http polar-sandbox https://mcp.polar.sh/mcp/polar-sandbox
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "polar-sandbox": {
      "url": "https://mcp.polar.sh/mcp/polar-sandbox"
    }
  }
}
```

For other clients, follow the [Polar MCP guide](https://polar.sh/docs/integrate/mcp). After installing, the user restarts their editor or CLI and signs in when prompted (in Claude Code, run `/mcp` and authenticate). The sandbox server signs in at sandbox.polar.sh and the production server at polar.sh.

Once authenticated, verify MCP works by listing organizations.

### Step 3: Gather Project Context

Ask the user:

1. **Framework**: What framework are you using?
   - Next.js (App Router), Express, Hono, Astro, SvelteKit, Remix, TanStack Start, Nuxt, Fastify, Cloudflare Workers, or another TypeScript/JavaScript framework
   - Python: there's no integration skill; follow the [Python SDK docs](https://polar.sh/docs/integrate/sdk/python)

2. **Environment**: Start with sandbox or production?
   - Sandbox (recommended for new setups)
   - Production

3. **Product type**: What are you selling?
   - Subscription (recurring)
   - One-time purchase
   - Both

From here on, use the `polar-sandbox` server's tools for sandbox and the `polar` server's tools for production. If only `polar` is available (as in ChatGPT), create sandbox products in the sandbox dashboard or with the Polar CLI instead.

### Step 4: Choose the Organization

List the organizations with MCP. If there are several, ask which one to use. Note its `id`, `slug` and `default_presentment_currency`. Signing in to the MCP server already asks a user without an organization to create one; without MCP, they can create one at:
- Sandbox: https://sandbox.polar.sh/start
- Production: https://polar.sh/start

### Step 5: Create First Product

Create the product with MCP (`POST /v1/products/`). The price must be in the organization's `default_presentment_currency`, and the billing interval is fixed per product. Example for a monthly subscription:

```json
{
  "organization_id": "<organization id from Step 4>",
  "name": "Pro Plan",
  "recurring_interval": "month",
  "prices": [{ "amount_type": "fixed", "price_amount": 2900, "price_currency": "<default_presentment_currency>" }]
}
```

Omit `recurring_interval` for a one-time purchase. "Both", or monthly and yearly billing, means separate products. Show the user the server, organization, name, price, currency and interval, and create the product once they confirm.

Store the returned product ID for checkout integration.

### Step 6: Generate Integration Code

Hand off to the `polar-integration` skill to generate the Checkout, Customer Portal, and Webhooks endpoints for the framework selected in Step 3. That skill has the canonical, framework-agnostic recipes plus per-framework variations.

Before invoking it, make sure the user has these environment variables ready (use whatever loader their framework provides):

```bash
POLAR_ACCESS_TOKEN=          # organization access token, created below
POLAR_WEBHOOK_SECRET=        # created in Step 7
POLAR_ENVIRONMENT=sandbox    # omit or set to "production" when going live
```

The quickest way to create the access token is the Polar CLI. Install it with `npm install -g @polar-sh/cli`, then ask the user to run:

```bash
polar auth login --sandbox
token=$(polar auth token --scope checkouts:write --scope customer_sessions:write) && echo "POLAR_ACCESS_TOKEN=$token" >> .env
```

`polar auth token` opens the token page in a browser with those scopes preselected, waits for the user to create the token, and prints it, so this saves it to `.env` without showing it. The token belongs to the active organization and its environment: `polar auth whoami --json` shows which one that is, and `polar auth org` changes it.

Without the CLI, create the token in the sandbox or production dashboard: Settings → Access Tokens → Create token.

Pass along the product ID from Step 5 so checkout links can be tested in Step 8.

### Step 7: Set Up Webhooks

Start the dev server, then follow `polar-testing` ("Local Webhook Testing") to forward webhooks to it with the Polar CLI. It needs no tunnel and no dashboard endpoint:

1. If you skipped it in Step 6, install the CLI and ask the user to run `polar auth login --sandbox`, which opens a browser.
2. Save the local signing secret to `.env` with `polar webhook listen --print-secret`, then restart the dev server.
3. Start `polar webhook listen <port>/<webhook-path>` in the background, using the path from the route generated in Step 6. Pass `--org <id from Step 4>` if the account has several organizations.
4. Run `polar webhook trigger order.paid`. Success is exit 0 with a `Response 2xx` line. On a failure it prints the handler's response and exits with status 1; fix the handler and repeat. If it only says the event was forwarded by your `polar webhook listen` terminal, check the `listen` output.

When deploying, create a webhook endpoint for the public URL in the dashboard (Settings → Webhooks) or with MCP (`url`, `format: "raw"` and the `events`: `order.paid`, `subscription.created` and `subscription.canceled`). Use that endpoint's secret as `POLAR_WEBHOOK_SECRET` in the deployed environment. The MCP response contains the secret, so tell the user where to copy it rather than repeating it.

### Step 8: Test the Integration

1. Visit the checkout URL with the product ID from Step 5 (path and query shape come from the route generated in Step 6).
2. Complete checkout using test card: `4242 4242 4242 4242`.
3. Verify that `polar webhook listen` shows `order.paid` with a 2xx status from the handler.
4. Check the success page displays correctly.

### Step 9: Next Steps

Once basic setup works, suggest:

1. **Link to your auth** - Pass `external_customer_id` from the logged-in user when creating checkouts.
2. **Add benefits** - License keys, file downloads, Discord roles.
3. **Go production** - Production is separate from sandbox: set up the organization at polar.sh, re-create the product (it gets a new ID), create a production access token and webhook endpoint, and set `POLAR_ENVIRONMENT=production`. Then submit the organization for review in the dashboard; checkouts are blocked until it can accept payments.
