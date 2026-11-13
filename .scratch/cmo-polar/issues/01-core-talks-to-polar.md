# 01: Core talks to Polar

Spec: `.scratch/cmo-polar/spec.md` (SOKD-204). Decisions: `docs/adr/0068-cmo-sells-its-plans-through-polar.md`.

**What to build:** Core can reach Polar and Polar can reach Core. An operator sets an access token, a webhook secret and the environment (sandbox or production); Core then reads the catalog of CMO plans and Project top-up packs from Polar's products, and accepts signed Polar events on a webhook route. Nothing is granted yet: this ticket ends where an event is verified and acknowledged. A deployment without the configuration keeps working and refuses Polar requests clearly.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] One Polar client module on the current Polar TypeScript SDK (1.x, dated API version import, pinned) is the only place that talks to Polar; tests replace this module and nothing else.
- [x] The three settings are optional in Core's env schema, with test defaults in Core's test setup and entries in the env example.
- [x] The catalog lists six plans (three tiers, monthly and yearly) and three packs from product metadata (kind, tier slug, credits), cached per process as the Stripe subscription catalog is; a product without valid metadata is ignored and reported.
- [x] A Polar webhook route sits in Core's signature-verified webhook router, outside session auth, and verifies the raw body with the SDK's check.
- [x] A bad signature answers 403, an unknown event type answers 202, a known event type answers 2xx.
- [x] Without configuration the webhook route answers 503.
- [x] Route-level tests cover each answer above with the Polar client module replaced.
