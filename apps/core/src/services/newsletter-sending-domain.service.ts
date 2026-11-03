import type { NewsletterSendingDomain } from "@sokosumi/database";

import {
  CloudflareApiError,
  type CloudflareZone,
  cloudflareDnsClient,
} from "@/clients/cloudflare-dns.client";
import {
  createEmailDomain,
  getEmailDomain,
  removeEmailDomain,
  verifyEmailDomain,
} from "@/clients/email.client";
import { getEnv, getWebAppBaseUrl } from "@/config/env";
import {
  badGateway,
  conflict,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import {
  isPrismaRecordNotFoundError,
  isPrismaUniqueViolation,
} from "@/helpers/prisma";
import prisma, { type DbClient } from "@/lib/db/prisma";
import { hasDmarcPolicy } from "@/lib/newsletter/dmarc";
import {
  buildDomainConnectApplyUrl,
  discoverDomainConnectProvider,
  domainConnectTemplateInput,
} from "@/lib/newsletter/domain-connect";
import {
  newsletterSenderMailbox,
  newsletterSenderOptions,
} from "@/lib/newsletter/email";
import {
  type NewsletterDnsRecord,
  relativeHost,
  sendingDomainFailureReason,
  sendingDomainOf,
  toNewsletterDnsRecords,
  toSendingDomainStatus,
  withDmarcRecord,
  zoneCandidates,
} from "@/lib/newsletter/sending-domain";
import {
  utcDay,
  warmupDailyCap,
  warmupDay,
} from "@/lib/newsletter/sending-domain-warmup";
import { newsletterDnsRecordsSchema } from "@/schemas/newsletter-sending-domain.schema";

/** A pending domain is re-read from Resend at most this often on its own. */
const LAZY_REFRESH_MS = 60_000;
const CLOUDFLARE_RECORD_TYPES = new Set(["TXT", "MX", "CNAME"]);
/**
 * Cloudflare's codes for a token it cannot use: malformed Authorization header
 * (6003/6111, e.g. a Global API Key pasted as a token), invalid token (1000,
 * 9109) and authentication error (10000). Some come back as HTTP 400.
 */
const CLOUDFLARE_TOKEN_REJECTED_CODES = new Set([
  1000, 6003, 6111, 9109, 10000,
]);

function statusCodeOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === "number" ? statusCode : null;
}

async function findSendingDomain(projectId: string) {
  return prisma.newsletterSendingDomain.findUnique({ where: { projectId } });
}

function withWarmupState(row: NewsletterSendingDomain) {
  const now = new Date();
  const day = row.warmupStartedAt ? warmupDay(row.warmupStartedAt, now) : null;
  return {
    ...row,
    warmup: {
      startedAt: row.warmupStartedAt,
      day,
      dailyCap: day === null ? null : warmupDailyCap(day),
      sentToday:
        row.warmupSentOnDayUtc?.getTime() === utcDay(now).getTime()
          ? row.warmupSentCount
          : 0,
      pausedAt: row.warmupPausedAt,
      pauseReason: row.warmupPauseReason,
    },
  };
}

async function requireSendingDomain(projectId: string) {
  const domain = await findSendingDomain(projectId);
  if (!domain) throw notFound("No newsletter sending domain");
  return domain;
}

function storedRecords(row: NewsletterSendingDomain): NewsletterDnsRecord[] {
  return newsletterDnsRecordsSchema.parse(row.dnsRecords);
}

/** Reads Resend's view of the domain into the row; `verify` asks Resend to look again first. */
async function refreshSendingDomain(
  row: NewsletterSendingDomain,
  { verify, dmarc = true }: { verify: boolean; dmarc?: boolean },
): Promise<NewsletterSendingDomain> {
  if (verify) await verifyEmailDomain(row.resendDomainId);
  const remote = await getEmailDomain(row.resendDomainId);
  const dnsRecords = withDmarcRecord(
    row.domain,
    toNewsletterDnsRecords(row.domain, remote.records),
    storedRecords(row),
    dmarc ? await hasDmarcPolicy(row.domain) : null,
  );
  const status = toSendingDomainStatus(remote.status);
  const now = new Date();
  const update = (client: Pick<DbClient, "newsletterSendingDomain">) =>
    client.newsletterSendingDomain.update({
      where: { id: row.id },
      data: {
        status,
        dnsRecords,
        lastCheckedAt: now,
        failureReason:
          status === "FAILED" ? sendingDomainFailureReason(dnsRecords) : null,
      },
    });
  try {
    if (
      status === "VERIFIED" &&
      row.status !== "VERIFIED" &&
      !row.warmupStartedAt
    ) {
      return await prisma.$transaction(async (tx) => {
        await tx.newsletterSendingDomain.updateMany({
          where: {
            id: row.id,
            warmupStartedAt: null,
            status: { not: "VERIFIED" },
          },
          data: { warmupStartedAt: now },
        });
        return update(tx);
      });
    }
    return await update(prisma);
  } catch (error) {
    if (isPrismaRecordNotFoundError(error)) {
      throw notFound("No newsletter sending domain");
    }
    throw error;
  }
}

/** A domain still waiting on DNS whose last read is older than {@link LAZY_REFRESH_MS}. */
function needsLazyRefresh(row: NewsletterSendingDomain): boolean {
  return (
    row.status !== "VERIFIED" &&
    (!row.lastCheckedAt ||
      Date.now() - row.lastCheckedAt.getTime() > LAZY_REFRESH_MS)
  );
}

/**
 * Lazily re-reads a pending domain; a Resend outage keeps the stored row.
 * Sending skips the DMARC lookup, which only the settings view shows.
 */
async function withLazyRefresh(
  row: NewsletterSendingDomain | null,
  { dmarc }: { dmarc: boolean },
): Promise<NewsletterSendingDomain | null> {
  if (!row || !needsLazyRefresh(row)) return row;
  return refreshSendingDomain(row, { verify: false, dmarc }).catch(() => row);
}

export async function getNewsletterSendingDomain(projectId: string) {
  const row = await withLazyRefresh(await findSendingDomain(projectId), {
    dmarc: true,
  });
  return row ? withWarmupState(row) : null;
}

/**
 * Sets the Project's From address. A new domain is registered with Resend;
 * the same domain with another local part only changes the address.
 */
export async function putNewsletterSendingDomain(
  projectId: string,
  fromAddress: string,
) {
  const domain = sendingDomainOf(fromAddress);
  const address = `${fromAddress.slice(0, fromAddress.lastIndexOf("@"))}@${domain}`;
  const existing = await findSendingDomain(projectId);
  if (existing) {
    if (existing.domain !== domain) {
      throw conflict("Remove the current sending domain before adding another");
    }
    return withWarmupState(
      await prisma.newsletterSendingDomain.update({
        where: { id: existing.id },
        data: { fromAddress: address },
      }),
    );
  }
  if (
    await prisma.newsletterSendingDomain.findUnique({
      where: { domain },
      select: { id: true },
    })
  ) {
    throw conflict("This domain is already connected to another project");
  }

  let created: Awaited<ReturnType<typeof createEmailDomain>>;
  try {
    created = await createEmailDomain(domain);
  } catch (error) {
    const status = statusCodeOf(error);
    if (status !== null && status >= 400 && status < 500) {
      throw unprocessableEntity(
        `Resend could not add ${domain}: ${error instanceof Error ? error.message : "refused"}`,
      );
    }
    throw error;
  }
  const dnsRecords = withDmarcRecord(
    domain,
    toNewsletterDnsRecords(domain, created.records),
    [],
    await hasDmarcPolicy(domain),
  );
  try {
    return withWarmupState(
      await prisma.newsletterSendingDomain.create({
        data: {
          projectId,
          domain,
          fromAddress: address,
          resendDomainId: created.id,
          status: toSendingDomainStatus(created.status),
          ...(toSendingDomainStatus(created.status) === "VERIFIED"
            ? { warmupStartedAt: new Date() }
            : {}),
          dnsRecords,
          lastCheckedAt: new Date(),
        },
      }),
    );
  } catch (error) {
    // Don't strand a Resend domain no row points at.
    await removeEmailDomain(created.id).catch(() => undefined);
    if (isPrismaUniqueViolation(error)) {
      throw conflict("This project or domain already has a sending domain");
    }
    throw error;
  }
}

/** "Check now": asks Resend to verify the DNS records, then stores the result. */
export async function checkNewsletterSendingDomain(projectId: string) {
  return withWarmupState(
    await refreshSendingDomain(await requireSendingDomain(projectId), {
      verify: true,
    }),
  );
}

/** Deletes the domain in Resend, then the row. Resend already lacking it is fine. */
export async function removeNewsletterSendingDomain(projectId: string) {
  const row = await requireSendingDomain(projectId);
  try {
    await removeEmailDomain(row.resendDomainId);
  } catch (error) {
    if (statusCodeOf(error) !== 404) {
      throw badGateway("Resend could not remove the domain. Try again.");
    }
  }
  await prisma.newsletterSendingDomain.deleteMany({ where: { id: row.id } });
}

async function findCloudflareZone(
  domain: string,
  apiToken: string,
): Promise<{
  zone: CloudflareZone | null;
  client: ReturnType<typeof cloudflareDnsClient>;
}> {
  const client = cloudflareDnsClient(apiToken);
  for (const candidate of zoneCandidates(domain)) {
    const zones = await client.listZones(candidate);
    const zone = zones.find((zone) => zone.name === candidate);
    if (zone) return { zone, client };
  }
  return { zone: null, client };
}

/**
 * Creates the domain's DNS records in Cloudflare with a user-pasted token. The
 * token is used for this request only: never stored, logged, or echoed.
 */
export async function connectNewsletterSendingDomainWithCloudflare(
  projectId: string,
  apiToken: string,
) {
  const row = await requireSendingDomain(projectId);
  try {
    const { zone, client } = await findCloudflareZone(row.domain, apiToken);
    if (!zone) {
      throw unprocessableEntity(
        `This Cloudflare token cannot edit DNS for ${row.domain}. Create a token with Zone · DNS · Edit for its zone.`,
      );
    }
    // Re-checked live: a second DMARC record would invalidate both.
    const addDmarc = (await hasDmarcPolicy(row.domain)) === false;
    for (const record of storedRecords(row)) {
      if (!CLOUDFLARE_RECORD_TYPES.has(record.type)) continue;
      if (relativeHost(record.name, zone.name) === null) continue;
      if (record.record === "DMARC" && !addDmarc) continue;
      await client.createDnsRecord(zone.id, {
        type: record.type,
        name: record.name,
        content: record.value,
        ...(record.priority !== null ? { priority: record.priority } : {}),
      });
    }
  } catch (error) {
    if (!(error instanceof CloudflareApiError)) throw error;
    if (
      error.status === 401 ||
      error.status === 403 ||
      error.codes.some((code) => CLOUDFLARE_TOKEN_REJECTED_CODES.has(code))
    ) {
      throw unprocessableEntity(
        "Cloudflare rejected the token. Check it has Zone · DNS · Edit for this domain.",
      );
    }
    throw badGateway(error.message);
  }
  // Records were written; a slow Resend check must not hide that.
  return withWarmupState(
    await refreshSendingDomain(row, { verify: true }).catch(() => row),
  );
}

/**
 * The one-click Domain Connect link for the domain's DNS provider, or null
 * when signing is unconfigured, nothing is left to add, Resend's records fall
 * outside the template, or the provider does not serve the template yet.
 */
export async function getNewsletterSendingDomainConnect(projectId: string) {
  const privateKey = getEnv().DOMAIN_CONNECT_PRIVATE_KEY;
  const row = await requireSendingDomain(projectId);
  if (!privateKey) return null;
  const template = domainConnectTemplateInput(row.domain, storedRecords(row));
  if (!template) return null;
  // A verified domain only still needs its missing DMARC policy.
  const groupIds =
    row.status === "VERIFIED"
      ? template.groupIds.filter((groupId) => groupId !== "mail")
      : template.groupIds;
  if (!groupIds.length) return null;
  const provider = await discoverDomainConnectProvider(row.domain).catch(
    () => null,
  );
  if (!provider) return null;
  const redirect = new URL("/newsletter/settings", getWebAppBaseUrl());
  redirect.searchParams.set("projectId", projectId);
  return {
    providerName: provider.providerName,
    applyUrl: buildDomainConnectApplyUrl({
      urlSyncUX: provider.urlSyncUX,
      zone: provider.zone,
      domain: row.domain,
      variables: template.variables,
      groupIds,
      redirectUri: redirect.href,
      privateKey,
    }),
  };
}

export async function resolveNewsletterSendingContext(newsletter: {
  projectId: string;
  senderName: string;
  replyTo: string;
}) {
  const row = await withLazyRefresh(
    await findSendingDomain(newsletter.projectId),
    {
      dmarc: false,
    },
  );
  return {
    // Preserve the custom sender while paused; the dispatch gate blocks it.
    sender: newsletterSenderOptions(
      newsletter,
      row?.warmupPausedAt
        ? { fromAddress: row.fromAddress, status: "VERIFIED" }
        : row,
    ),
    domain:
      row && (row.status === "VERIFIED" || row.warmupPausedAt) ? row : null,
  };
}

function assertWarmupNotPaused(
  domain: { status: string; warmupPausedAt: Date | null } | null,
) {
  if (domain?.warmupPausedAt) {
    throw conflict(
      "Newsletter sending domain warm-up is paused. Resume it in Newsletter settings.",
    );
  }
}

/** From and Reply-To for a newsletter email, per {@link newsletterSenderOptions}. */
export async function resolveNewsletterSender(newsletter: {
  projectId: string;
  senderName: string;
  replyTo: string;
}) {
  const { sender, domain } = await resolveNewsletterSendingContext(newsletter);
  assertWarmupNotPaused(domain);
  return sender;
}

export async function resumeNewsletterSendingDomainWarmup(projectId: string) {
  const row = await requireSendingDomain(projectId);
  if (row.status !== "VERIFIED" || !row.warmupStartedAt) {
    throw conflict(
      "Verify the newsletter sending domain before resuming warm-up",
    );
  }
  return withWarmupState(
    await prisma.newsletterSendingDomain.update({
      where: { id: row.id },
      data: { warmupPausedAt: null, warmupPauseReason: null },
    }),
  );
}

/**
 * Refuses to schedule when nothing could send: no verified domain and no
 * shared fallback. Reads the stored status, without calling Resend, so it is
 * safe inside a transaction.
 */
export async function assertNewsletterSenderConfigured(
  projectId: string,
  client: Pick<DbClient, "newsletterSendingDomain"> = prisma,
): Promise<void> {
  const domain = await client.newsletterSendingDomain.findUnique({
    where: { projectId },
    select: { fromAddress: true, status: true, warmupPausedAt: true },
  });
  assertWarmupNotPaused(domain);
  newsletterSenderMailbox(domain);
}
