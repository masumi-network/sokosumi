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
(Cloudflare, GoDaddy, IONOS, …) onboards this template**. For Cloudflare, follow
its [Domain Connect onboarding guide](https://developers.cloudflare.com/dns/reference/domain-connect/):

1. Open a pull request to [Domain-Connect/Templates](https://github.com/Domain-Connect/Templates)
   with `sokosumi.com.newsletter.json`. Lint it with
   `dc-template-linter -cloudflare sokosumi.com.newsletter.json` and include an
   [Online Editor](https://domainconnect.paulonet.eu/) test-results link, which
   the Templates maintainers require.
2. After that pull request is **merged** and the `_dck1.sokosumi.com` TXT record
   is live, email **domain-connect@cloudflare.com** with the template GitHub
   link(s), the FQDN for the `syncPubKeyDomain` TXT record
   (`_dck1.sokosumi.com`), and a logo (SVG preferred). Note that this template
   has no A/AAAA/CNAME records, so proxy status is N/A.

Until Cloudflare serves the template, Core's discovery
(`GET {urlAPI}/v2/domainTemplates/providers/sokosumi.com/services/newsletter`)
returns 404 and the UI falls back to the Cloudflare API token or manual records.
That fallback is unchanged. Follow each other provider's onboarding separately.

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
| `mail`  | SPF: lets Sokosumi send for you                | SPFM             | `send`              | `include:amazonses.com`                | fixed       |
| `dmarc` | DMARC: tells inboxes how to treat failing mail | TXT              | `_dmarc`            | `v=DMARC1; p=none;`                    | fixed       |

Before offering one-click, Core matches Resend's returned TXT SPF value
`v=spf1 include:amazonses.com ~all` to the template's SPFM rule
`include:amazonses.com`.

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
- Resend's TXT SPF value is exactly `v=spf1 include:amazonses.com ~all`, which
  maps to the template's SPFM rule `include:amazonses.com`.
- The MX priority is 10; only the host varies with the Resend region.
- A subdomain such as `news.brand.com` is applied as `domain=brand.com&host=news`
  where `brand.com` is the zone holding `_domainconnect`.

If Resend changes its record shape, update the template (bump `version`),
`domainConnectTemplateInput`, and its tests together, then resubmit to providers.

## Signing

The template sets `syncPubKeyDomain: sokosumi.com`, so every apply URL must be
signed. Core signs the unsigned query with RSA-SHA256 using
`DOMAIN_CONNECT_PRIVATE_KEY` (PEM), then appends `key=_dck1` followed by `sig=…`.
Cloudflare requires `sig` to be the last query parameter. Neither `key` nor
`sig` is included in the signed bytes. Publish the public key at
`_dck1.sokosumi.com` before onboarding:

```text
_dck1.sokosumi.com. TXT "p=1,a=RS256,d=<base64 SPKI public key>"
```

Long keys split across several TXT records (`p=1`, `p=2`, …) per the spec.
Without `DOMAIN_CONNECT_PRIVATE_KEY`, Core never offers the one-click button.

`syncRedirectDomain` is `app.sokosumi.com`. Preview deployments use other
hosts, so providers that enforce this field can reject their redirects.
Cloudflare uses the signed `redirect_uri` instead. Test one-click on production
or a provider's test environment.
