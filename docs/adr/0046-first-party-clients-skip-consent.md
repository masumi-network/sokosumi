# First-party clients skip consent

[ADR 0045](0045-cmo-signs-in-through-core-oauth-provider.md) made every user see the consent screen once, because Core's `/v1` bearer check requires a stored consent that grants `sokosumi:api`. For a person with no Sokosumi account who starts at CMO, that screen is the third Sokosumi page in a row, and it warns them about "full API access" to a product Sokosumi runs itself. A first-party client therefore skips consent through the OAuth provider's own `skipConsent` flag on its client row, and Core's bearer check accepts that client's tokens without a consent row. This amends the consent consequence of ADR 0045; the rest of it stands.

## Considered Options

- **Keep the screen with friendlier copy.** No Core change, but the extra page stays on the path of every new CMO user.
- **Record the consent automatically.** The consent page would accept on load for an allow-list of client IDs kept in Web's environment. Core stays untouched and the grant stays revocable, but it imitates a feature the provider already ships, still loads the page, and needs a second list of clients beside the client rows.

## Consequences

- Only the provider's admin endpoints can set `skipConsent`; dynamic registration rejects it, and the client form under Developer settings does not offer it. A client a user registers can never become first-party.
- The bearer check reads the flag on every request, so clearing it on a client row ends `/v1` access for every user of that client who has no consent row.
- A first-party client does not appear under authorized apps, because that list is built from consent rows. Access ends when the person signs out of the product, or when the account is banned.
- The consent screen used to create the personal workspace when the person pressed Authorize. A first-party product now ensures the workspace itself at sign-in.
- After sign-in or sign-up the provider returns the redirect to the client directly. Web must follow that redirect and navigate once: a second navigation delivers the authorization code twice, and Core revokes a confidential client's tokens when a code is exchanged twice.
- CMO is the only first-party client. The Apple apps and the CLI are public clients, whose identity a custom scheme or loopback redirect cannot assure (RFC 8252 section 8.6), so they keep the consent screen until that risk is decided separately.
