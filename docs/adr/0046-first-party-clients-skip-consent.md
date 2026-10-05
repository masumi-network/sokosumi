# First-party clients skip consent

[ADR 0045](0045-cmo-signs-in-through-core-oauth-provider.md) made every user see the consent screen once, because Core's `/v1` bearer check requires a stored consent that grants `sokosumi:api`. For a person with no Sokosumi account who starts at CMO, that screen is the third Sokosumi page in a row, and it warns them about "full API access" to a product Sokosumi runs itself. A first-party client therefore skips consent through the OAuth provider's own `skipConsent` flag on its client row, and Core's bearer check accepts that client's tokens without a consent row. This amends the consent consequence of ADR 0045; the rest of it stands.

## Considered Options

- **Keep the screen with friendlier copy.** No Core change, but the extra page stays on the path of every new CMO user.
- **Record the consent automatically.** The consent page would accept on load for an allow-list of client IDs kept in Web's environment. Core stays untouched and the grant stays revocable, but it imitates a feature the provider already ships, still loads the page, and needs a second list of clients beside the client rows.

## Consequences

- Only the provider's admin endpoints can set `skipConsent`; dynamic registration rejects it, and the client form under Developer settings does not offer it. A client a user registers can never become first-party.
- The bearer check reads the flag on every request, so clearing it on a client row ends `/v1` access for every user of that client who has no consent row.
- A first-party client does not appear under authorized apps, because that list is built from consent rows. Access ends when the person signs out of the product, or when the account is banned. It also ends when the person resets or changes their Sokosumi password or signs out of all or their other Sokosumi sessions, because Core then revokes every app token of that person; a plain Sokosumi sign-out leaves app tokens alone, and the app notices at its next token refresh (CMO within 2 hours). (Amended 2026-10-02.)
- The consent screen used to create the personal workspace when the person pressed Authorize. CMO creates none at sign-in for now; that is still to be decided. The Sokosumi Apple app creates none: it tells a person who has no workspace to finish setup on the web.
- After sign-in or sign-up the provider returns the redirect to the client directly. Web must follow that redirect and navigate once: a second navigation delivers the authorization code twice, and Core revokes a confidential client's tokens when a code is exchanged twice.
- A public client can be first-party only when its redirect proves which app receives it. The Sokosumi Apple app takes its redirect at a claimed HTTPS link, `https://app.sokosumi.com/auth/apple/callback` (RFC 8252 section 7.2): the host lists the app in its `apple-app-site-association` file, and the system hands the link to no other app. Its client row carries that redirect and no custom scheme. A custom scheme on a row that skips consent would give any app that registers the scheme an authorization code without the person being asked. (Amended 2026-09-30; the Apple app kept the consent screen before.)
- The CLI keeps the consent screen: a loopback redirect cannot assure which program receives it (RFC 8252 section 8.6).
