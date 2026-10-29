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
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import {
  isPrismaRecordNotFoundError,
  isPrismaUniqueViolation,
} from "@/helpers/prisma";
import { organizationRoleInWorkspace } from "@/helpers/soko-bot-management";
import prisma, { type DbClient } from "@/lib/db/prisma";
import { hasDmarcPolicy } from "@/lib/newsletter/dmarc";
import {
  buildDomainConnectApplyUrl,
  discoverDomainConnectProvider,
  domainConnectTemplateInput,
} from "@/lib/newsletter/domain-connect";
import {
  type NewsletterSendingDomainSender,
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
import type { WorkspaceContext } from "@/middleware/workspace";
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

/**
 * Who may add, verify, connect and remove the Workspace's sending domain: an
 * Organization OWNER or ADMIN, read live, or a personal Workspace's owner.
 * Agents never may; callers reject them before this.
 */
export async function canManageNewsletterSendingDomain(
  userId: string,
  workspace: WorkspaceContext,
): Promise<boolean> {
  if (workspace.userId) return workspace.userId === userId;
  const role = await organizationRoleInWorkspace(
    userId,
    workspace.workspaceId,
    prisma,
  );
  return role !== null && isOrganizationOwnerOrAdmin(role);
}

export async function assertCanManageNewsletterSendingDomain(
  userId: string,
  workspace: WorkspaceContext,
): Promise<void> {
  if (await canManageNewsletterSendingDomain(userId, workspace)) return;
  throw forbidden(
    "Only a workspace owner or admin can manage the newsletter sending domain",
  );
}

async function findSendingDomain(workspaceId: string) {
  return prisma.newsletterSendingDomain.findUnique({ where: { workspaceId } });
}

async function requireSendingDomain(workspaceId: string) {
  const domain = await findSendingDomain(workspaceId);
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
  try {
    return await prisma.newsletterSendingDomain.update({
      where: { id: row.id },
      data: {
        status,
        dnsRecords,
        lastCheckedAt: new Date(),
        failureReason:
          status === "FAILED" ? sendingDomainFailureReason(dnsRecords) : null,
      },
    });
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

export async function getNewsletterSendingDomain(workspaceId: string) {
  return withLazyRefresh(await findSendingDomain(workspaceId), {
    dmarc: true,
  });
}

/**
 * Sets the Workspace's From address. A new domain is registered with Resend;
 * the same domain with another local part only changes the address.
 */
export async function putNewsletterSendingDomain(
  workspaceId: string,
  fromAddress: string,
) {
  const domain = sendingDomainOf(fromAddress);
  const address = `${fromAddress.slice(0, fromAddress.lastIndexOf("@"))}@${domain}`;
  const existing = await findSendingDomain(workspaceId);
  if (existing) {
    if (existing.domain !== domain) {
      throw conflict("Remove the current sending domain before adding another");
    }
    return prisma.newsletterSendingDomain.update({
      where: { id: existing.id },
      data: { fromAddress: address },
    });
  }
  if (
    await prisma.newsletterSendingDomain.findUnique({
      where: { domain },
      select: { id: true },
    })
  ) {
    throw conflict("This domain is already connected to another workspace");
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
    return await prisma.newsletterSendingDomain.create({
      data: {
        workspaceId,
        domain,
        fromAddress: address,
        resendDomainId: created.id,
        status: toSendingDomainStatus(created.status),
        dnsRecords,
        lastCheckedAt: new Date(),
      },
    });
  } catch (error) {
    // Don't strand a Resend domain no row points at.
    await removeEmailDomain(created.id).catch(() => undefined);
    if (isPrismaUniqueViolation(error)) {
      throw conflict("This workspace or domain already has a sending domain");
    }
    throw error;
  }
}

/** "Check now": asks Resend to verify the DNS records, then stores the result. */
export async function checkNewsletterSendingDomain(workspaceId: string) {
  return refreshSendingDomain(await requireSendingDomain(workspaceId), {
    verify: true,
  });
}

/** Deletes the domain in Resend, then the row. Resend already lacking it is fine. */
export async function removeNewsletterSendingDomain(workspaceId: string) {
  const row = await requireSendingDomain(workspaceId);
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
  workspaceId: string,
  apiToken: string,
) {
  const row = await requireSendingDomain(workspaceId);
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
  return refreshSendingDomain(row, { verify: true }).catch(() => row);
}

/**
 * The one-click Domain Connect link for the domain's DNS provider, or null
 * when signing is unconfigured, nothing is left to add, Resend's records fall
 * outside the template, or the provider does not serve the template yet.
 */
export async function getNewsletterSendingDomainConnect(
  workspaceId: string,
  projectId: string | undefined,
) {
  const privateKey = getEnv().DOMAIN_CONNECT_PRIVATE_KEY;
  const row = await requireSendingDomain(workspaceId);
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
  if (projectId) redirect.searchParams.set("projectId", projectId);
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

async function sendingDomainSender(
  workspaceId: string,
): Promise<NewsletterSendingDomainSender | null> {
  const row = await withLazyRefresh(await findSendingDomain(workspaceId), {
    dmarc: false,
  });
  return row ? { fromAddress: row.fromAddress, status: row.status } : null;
}

/** From and Reply-To for a newsletter email, per {@link newsletterSenderOptions}. */
export async function resolveNewsletterSender(newsletter: {
  workspaceId: string;
  senderName: string;
  replyTo: string;
}) {
  return newsletterSenderOptions(
    newsletter,
    await sendingDomainSender(newsletter.workspaceId),
  );
}

/**
 * Refuses to schedule when nothing could send: no verified domain and no
 * shared fallback. Reads the stored status, without calling Resend, so it is
 * safe inside a transaction.
 */
export async function assertNewsletterSenderConfigured(
  workspaceId: string,
  client: Pick<DbClient, "newsletterSendingDomain"> = prisma,
): Promise<void> {
  newsletterSenderMailbox(
    await client.newsletterSendingDomain.findUnique({
      where: { workspaceId },
      select: { fromAddress: true, status: true },
    }),
  );
}
