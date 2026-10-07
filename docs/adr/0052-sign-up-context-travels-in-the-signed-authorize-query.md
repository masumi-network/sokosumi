# Sign-up context travels in the signed authorize query

A first-party client such as CMO needs to hand values to the account it sends someone to create, for example the website the person typed on CMO's landing page, and read them back after sign-in. We record a **sign-up context** in its own table: one row per user, written once when Core creates the user, holding the **sign-up origin** and the entries (key to string, number or boolean). The client sends the entries as a single JSON parameter, `signup_context`, on the authorize URL. Core's OAuth provider already signs the whole authorize query, Web already returns it as `oauth_query` on every auth request, and the user-create hook can read it (`getOAuthProviderState()`, or the social state's `serverContext` for a provider sign-up), so the values need no new transport. The origin comes from a `signUpOrigin` field on the `OauthClient` row, never from the URL. Anyone can build an authorize URL with CMO's `client_id` and any `signup_context`, so the signature proves the values passed through Sokosumi's authorize endpoint, not that the client wrote them. Only the origin can be trusted; every entry is untrusted text.

## Considered Options

- **Extend `UTMAttribution`.** It already holds one row per user, but it answers which campaign or link brought the person: fixed `utm_*` keys, captured first-touch on the marketing site, possibly days before sign-up. The sign-up context holds values a product passes in one trip, under keys the product chooses. Merging the two would blur both, and UTM capture works and is documented in `apps/web/TRACKING.md`.
- **Store the values in `User.metadata`.** The browser can write it, so a person could later forge what their origin handed over, and it already holds unrelated settings (DESIGN.md, locale, timezone).
- **One URL parameter per key (`ctx_url=…`).** Easier to read, but every value arrives as a string, so `42` and `"42"` become the same value. The key names can also collide with parameters Web already uses (`email`, `returnUrl`, `invitationId`, `error`), which would break the signed query.
- **Origin from the URL or a Core env map.** A URL origin is forgeable. An env map needs a deploy per new client. A column on the client row is set per environment, next to the client it describes.
- **An origin on each entry.** An account is created exactly once, through one product, so the origin belongs to the sign-up. Keeping one origin per account requires the context to be written once and never extended later.

## Consequences

- Entries are open: any key matching `^[a-z][a-z0-9_]{0,63}$`, at most 10 per sign-up, values at most 2,048 characters. A malformed parameter or entry is dropped and never blocks a sign-up.
- Every account created after this ships gets a context, an origin-only one when no entries came. A client without `signUpOrigin` records `unknown`. A sign-up outside an OAuth request records `sokosumi`. Accounts created earlier have none, and none is backfilled.
- The person, through any client acting for them, and admins can read the context. Core's bearer context does not keep the calling client, so restricting reads to the origin would need new auth work to protect values the person already had in their own address bar.
- Sokosumi's own `/signup` page does not accept entries yet, since outside an OAuth request there is no signed query to carry them.
