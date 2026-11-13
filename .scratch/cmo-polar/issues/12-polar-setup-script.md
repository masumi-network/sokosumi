# 12: Polar setup script

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204), "Setup only a human can do".

**What to build:** The steps in Polar's dashboard that only a person can take, once for sandbox and once for production, as an interactive script generated with the `/wizard` skill. It opens each page, tells the person what to create, captures each value and writes it where Core reads it. The agent writes the script; the person runs it.

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [x] The script covers sandbox and production as separate runs and never mixes their values.
- [x] It walks through nine products with their metadata (kind, tier slug, credits): three monthly plans ($200 / 10,000, $500 / 25,000, $1,000 / 50,000), three yearly plans ($2,000, $5,000, $10,000, same monthly credits), three packs ($150 / 5,000, $300 / 10,000, $750 / 25,000).
- [x] It walks through an access token with the scopes Core needs (checkouts, customer sessions, subscriptions, products, orders), and the webhook endpoint with its secret and the events Core handles.
- [x] It walks through the portal settings: plan changes off.
- [x] It writes the token, the secret and the environment to the local env file and to Core's Vercel projects (sandbox for preview and preprod, production for mainnet), and prints no secret.
- [x] It ends by reading the catalog through Core and listing the nine entries, so a wrong metadata value is caught at once.
- [ ] The person has run it for sandbox.
