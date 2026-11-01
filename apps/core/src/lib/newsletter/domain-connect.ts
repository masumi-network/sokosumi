import { createSign } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { ssrfSafeFetch } from "@sokosumi/net";
import { z } from "zod";

import {
  DMARC_STARTER_VALUE,
  type NewsletterDnsRecord,
  relativeHost,
  zoneCandidates,
} from "./sending-domain";

export const DOMAIN_CONNECT_PROVIDER_ID = "sokosumi.com";
export const DOMAIN_CONNECT_SERVICE_ID = "newsletter";
/** Host under `sokosumi.com` whose TXT record holds the signing public key. */
export const DOMAIN_CONNECT_KEY_HOST = "_dck1";

const DKIM_HOST = "resend._domainkey";
const RETURN_PATH_HOST = "send";
const DMARC_HOST = "_dmarc";
/** Resend's TXT SPF maps to the template's SPFM `include:amazonses.com`. */
const RESEND_SPF_VALUE = "v=spf1 include:amazonses.com ~all";

/** What to apply from `docs/domainconnect/sokosumi.com.newsletter.json`. */
export interface DomainConnectTemplateInput {
  variables: Record<string, string>;
  /** `mail` always; `dmarc` only while the domain has no DMARC policy. */
  groupIds: string[];
}

/**
 * The template variables and groups for the domain's records, or null when
 * Resend asked for records the template does not create.
 */
export function domainConnectTemplateInput(
  domain: string,
  records: NewsletterDnsRecord[],
): DomainConnectTemplateInput | null {
  let dkimkey: string | undefined;
  let mxhost: string | undefined;
  let spf = false;
  let dmarcMissing = false;
  for (const record of records) {
    const host = relativeHost(record.name, domain);
    if (
      record.record === "DKIM" &&
      record.type === "TXT" &&
      host === DKIM_HOST
    ) {
      dkimkey = record.value;
    } else if (
      record.record === "SPF" &&
      record.type === "MX" &&
      host === RETURN_PATH_HOST &&
      record.priority === 10
    ) {
      mxhost = record.value;
    } else if (
      record.record === "SPF" &&
      record.type === "TXT" &&
      host === RETURN_PATH_HOST &&
      record.value === RESEND_SPF_VALUE
    ) {
      spf = true;
    } else if (
      record.record === "DMARC" &&
      host === DMARC_HOST &&
      record.value === DMARC_STARTER_VALUE
    ) {
      dmarcMissing = record.status !== "verified";
    } else {
      return null;
    }
  }
  if (!dkimkey || !mxhost || !spf) return null;
  return {
    variables: { dkimkey, mxhost },
    groupIds: dmarcMissing ? ["mail", "dmarc"] : ["mail"],
  };
}

export interface DomainConnectApplyUrlInput {
  /** `urlSyncUX` from the provider's settings. */
  urlSyncUX: string;
  /** The zone the provider manages, where `_domainconnect` was found. */
  zone: string;
  /** The sending domain, at or under `zone`. */
  domain: string;
  variables: Record<string, string>;
  groupIds: string[];
  redirectUri: string;
  /** PEM RSA private key whose public half is published at `_dck1.sokosumi.com`. */
  privateKey: string;
}

/**
 * The synchronous Domain Connect apply URL, signed as the spec requires for a
 * template with `syncPubKeyDomain`: RSA-SHA256 over the query string, then
 * `key` then `sig` appended (`sig` last, as Cloudflare requires).
 */
export function buildDomainConnectApplyUrl(
  input: DomainConnectApplyUrlInput,
): string {
  const host = relativeHost(input.domain, input.zone);
  if (host === null)
    throw new Error("Domain is outside the Domain Connect zone");
  const query = new URLSearchParams({ domain: input.zone });
  if (host !== "@") query.set("host", host);
  for (const [name, value] of Object.entries(input.variables)) {
    query.set(name, value);
  }
  query.set("groupId", input.groupIds.join(","));
  query.set("redirect_uri", input.redirectUri);
  const unsigned = query.toString();
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const sig = signer.sign(input.privateKey, "base64");
  const signed = new URLSearchParams({ key: DOMAIN_CONNECT_KEY_HOST, sig });
  const base = input.urlSyncUX.replace(/\/$/, "");
  return `${base}/v2/domainTemplates/providers/${DOMAIN_CONNECT_PROVIDER_ID}/services/${DOMAIN_CONNECT_SERVICE_ID}/apply?${unsigned}&${signed.toString()}`;
}

export interface DomainConnectProvider {
  /** The zone the provider manages, where `_domainconnect` was found. */
  zone: string;
  providerName: string;
  urlSyncUX: string;
}

const domainConnectSettingsSchema = z.object({
  providerName: z.string().min(1),
  providerDisplayName: z.string().min(1).optional(),
  urlSyncUX: z.url({ protocol: /^https$/ }),
  urlAPI: z.url({ protocol: /^https$/ }),
});
const DOMAIN_CONNECT_HOST = /^[a-z0-9.-]+(?:\/[\w.~-]+)*$/i;
const MAX_SETTINGS_BYTES = 64 * 1024;

/**
 * Finds the DNS provider for `domain` through `_domainconnect` TXT, and
 * returns it only when it serves Sokosumi's newsletter template. Every host
 * here comes from the user's DNS, so each fetch goes through the SSRF filter.
 */
export async function discoverDomainConnectProvider(
  domain: string,
): Promise<DomainConnectProvider | null> {
  const resolver = new Resolver({ timeout: 3_000, tries: 1 });
  for (const zone of zoneCandidates(domain)) {
    let records: string[][];
    try {
      records = await resolver.resolveTxt(`_domainconnect.${zone}`);
    } catch {
      continue;
    }
    const host = records[0]?.join("").trim().replace(/\/$/, "");
    if (!host || !DOMAIN_CONNECT_HOST.test(host)) return null;
    const settings = domainConnectSettingsSchema.safeParse(
      await fetchJson(`https://${host}/v2/${zone}/settings`),
    );
    if (!settings.success) return null;
    const template = await ssrfSafeFetch(
      `${settings.data.urlAPI.replace(/\/$/, "")}/v2/domainTemplates/providers/${DOMAIN_CONNECT_PROVIDER_ID}/services/${DOMAIN_CONNECT_SERVICE_ID}`,
      {
        maxResponseBytes: MAX_SETTINGS_BYTES,
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!template.ok) return null;
    return {
      zone,
      providerName:
        settings.data.providerDisplayName ?? settings.data.providerName,
      urlSyncUX: settings.data.urlSyncUX,
    };
  }
  return null;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await ssrfSafeFetch(url, {
    maxResponseBytes: MAX_SETTINGS_BYTES,
    signal: AbortSignal.timeout(5_000),
  });
  return response.ok ? response.json().catch(() => null) : null;
}
