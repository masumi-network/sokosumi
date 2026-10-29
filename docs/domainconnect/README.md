# Domain Connect template: Sokosumi newsletter sending domain

[`sokosumi.com.newsletter.json`](sokosumi.com.newsletter.json) is the
[Domain Connect](https://www.domainconnect.org) template behind the
"Connect with <provider>" button on Newsletter settings → Sending domain.

- Provider id: `sokosumi.com`
- Service id: `newsletter`
- Flow: synchronous, signed. Core builds the apply URL in
  `apps/core/src/lib/newsletter/domain-connect.ts`.

## Not live until providers approve it

One-click setup does nothing in production until **each DNS provider
(Cloudflare, GoDaddy, IONOS, …) onboards this template**. Submit it as a pull
request to [Domain-Connect/Templates](https://github.com/Domain-Connect/Templates)
and follow each provider's onboarding. Until a provider serves the template,
Core's discovery (`GET {urlAPI}/v2/domainTemplates/providers/sokosumi.com/services/newsletter`)
returns 404, the UI says one-click setup isn't available, and people use the
Cloudflare API token or copy the records by hand. Both always work.

## Records and variables

Resend asks for three records on the sending domain (group `mail`). When the
domain and its parents have no DMARC policy, Core also suggests a
monitoring-only one (group `dmarc`) and adds `groupId=mail,dmarc` to the apply
URL; otherwise it sends `groupId=mail`, so an existing policy is never
duplicated. Hosts are relative to the domain the user applies the template to
(`domain` plus optional `host`):

| Group   | Record                                         | Type             | Host                | Value                                  | Variable    |
| ------- | ---------------------------------------------- | ---------------- | ------------------- | -------------------------------------- | ----------- |
| `mail`  | DKIM: proves the mail is from you              | TXT              | `resend._domainkey` | `p=…`                                  | `%dkimkey%` |
| `mail`  | Return path: receives bounces                  | MX (priority 10) | `send`              | `feedback-smtp.<region>.amazonses.com` | `%mxhost%`  |
| `mail`  | SPF: lets Sokosumi send for you                | TXT              | `send`              | `v=spf1 include:amazonses.com ~all`    | fixed       |
| `dmarc` | DMARC: tells inboxes how to treat failing mail | TXT              | `_dmarc`            | `v=DMARC1; p=none;`                    | fixed       |

`p=none` only monitors. Sokosumi never suggests `quarantine` or `reject`; a
stricter policy is the domain owner's call.

The UI recommends a dedicated sending subdomain (`news@news.brand.com`), which
registers `news.brand.com` with Resend and keeps newsletter reputation apart
from the brand's everyday mail. Any valid address is still accepted.

Assumptions, checked by `domainConnectTemplateInput` before the button is offered:

- Resend's DKIM record is a TXT at `resend._domainkey`. A domain whose DKIM
  comes back as a CNAME, or with any extra record (click tracking, receiving),
  gets no one-click link and falls back to the other two options.
- The suggested DMARC record is exactly `v=DMARC1; p=none;` at `_dmarc`.
- The SPF value is exactly `v=spf1 include:amazonses.com ~all`.
- The MX priority is 10; only the host varies with the Resend region.
- A subdomain such as `news.brand.com` is applied as `domain=brand.com&host=news`
  where `brand.com` is the zone holding `_domainconnect`.

If Resend changes its record shape, update the template (bump `version`),
`domainConnectTemplateInput`, and its tests together, then resubmit to providers.

## Signing

The template sets `syncPubKeyDomain: sokosumi.com`, so every apply URL must be
signed. Core signs with RSA-SHA256 using `DOMAIN_CONNECT_PRIVATE_KEY` (PEM) and
sends `key=_dck1`. Publish the public half before onboarding:

```text
_dck1.sokosumi.com. TXT "p=1,a=RS256,d=<base64 SPKI public key>"
```

Long keys split across several TXT records (`p=1`, `p=2`, …) per the spec.
Without `DOMAIN_CONNECT_PRIVATE_KEY`, Core never offers the one-click button.

`syncRedirectDomain` is `app.sokosumi.com`. Preview deployments use other
hosts, so the provider rejects their redirect: test one-click on production
or a provider's test environment.
