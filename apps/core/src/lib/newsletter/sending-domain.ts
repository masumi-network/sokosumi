import type { NewsletterSendingDomainStatus } from "@sokosumi/database";

/** Written verbatim into `NewsletterSendingDomain.dnsRecords`. */
export type NewsletterDnsRecord = {
  /** Resend's purpose: SPF, DKIM, Receiving, Tracking or TrackingCAA. */
  record: string;
  type: string;
  /** Fully qualified host name, so every caller reads the same value. */
  name: string;
  value: string;
  ttl: string;
  priority: number | null;
  status: string;
};

interface ResendDnsRecord {
  record: string;
  type: string;
  name: string;
  value: string;
  ttl: string;
  status: string;
  priority?: number;
}

export function sendingDomainOf(fromAddress: string): string {
  return fromAddress.slice(fromAddress.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * The fully qualified host of a record Resend returned for `domain`.
 *
 * Resend names a subdomain's records relative to the apex (`send.news` for
 * `news.example.com`), and an apex domain's relative to itself (`send`). The
 * overlap between the name's tail and the domain's head tells them apart.
 */
export function recordFqdn(name: string, domain: string): string {
  const host = name.toLowerCase().replace(/\.$/, "");
  if (host === "@" || host === "" || host === domain) return domain;
  if (host.endsWith(`.${domain}`)) return host;
  const hostLabels = host.split(".");
  const domainLabels = domain.split(".");
  for (
    let overlap = Math.min(hostLabels.length - 1, domainLabels.length - 1);
    overlap > 0;
    overlap--
  ) {
    if (
      hostLabels.slice(-overlap).join(".") ===
      domainLabels.slice(0, overlap).join(".")
    ) {
      return [...hostLabels.slice(0, -overlap), ...domainLabels].join(".");
    }
  }
  return `${host}.${domain}`;
}

/** `fqdn` relative to `zone`, `@` for the zone itself, or null outside it. */
export function relativeHost(fqdn: string, zone: string): string | null {
  if (fqdn === zone) return "@";
  return fqdn.endsWith(`.${zone}`) ? fqdn.slice(0, -zone.length - 1) : null;
}

export function toNewsletterDnsRecords(
  domain: string,
  records: ResendDnsRecord[],
): NewsletterDnsRecord[] {
  return records.map((record) => ({
    record: record.record,
    type: record.type,
    name: recordFqdn(record.name, domain),
    value: record.value,
    ttl: record.ttl,
    priority: record.priority ?? null,
    status: record.status,
  }));
}

export function toSendingDomainStatus(
  resendStatus: string,
): NewsletterSendingDomainStatus {
  if (resendStatus === "verified") return "VERIFIED";
  if (resendStatus === "failed" || resendStatus === "partially_failed") {
    return "FAILED";
  }
  return "PENDING";
}

/** Plain-language reason for a failed domain, from its failed records. */
export function sendingDomainFailureReason(
  records: NewsletterDnsRecord[],
): string {
  const failed = records
    .filter((record) => record.status === "failed")
    .map((record) => `${record.record} ${record.type} ${record.name}`);
  return failed.length
    ? `Resend could not find these DNS records: ${failed.join(", ")}`
    : "Resend could not verify the domain's DNS records";
}

/** Zones that may hold `domain`, from the domain itself up to its parent. */
export function zoneCandidates(domain: string): string[] {
  const labels = domain.split(".");
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join("."));
}

/** A starter DMARC policy: report only, never reject. */
export const DMARC_STARTER_VALUE = "v=DMARC1; p=none;";

/**
 * Resend's records plus a suggested `_dmarc` TXT when the domain has no DMARC
 * policy. `found` is the latest lookup (`null` when DNS could not answer).
 * A suggestion stays listed, checked off, once the user publishes a policy.
 */
export function withDmarcRecord(
  domain: string,
  records: NewsletterDnsRecord[],
  previous: NewsletterDnsRecord[],
  found: boolean | null,
): NewsletterDnsRecord[] {
  const suggested = previous.find((record) => record.record === "DMARC");
  if (found === null) return suggested ? [...records, suggested] : records;
  if (found && !suggested) return records;
  return [
    ...records,
    {
      record: "DMARC",
      type: "TXT",
      name: `_dmarc.${domain}`,
      value: DMARC_STARTER_VALUE,
      ttl: "Auto",
      priority: null,
      status: found ? "verified" : "not_found",
    },
  ];
}
