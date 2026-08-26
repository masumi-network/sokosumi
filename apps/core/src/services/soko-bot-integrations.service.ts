import type { Prisma } from "@sokosumi/database";
import {
  getSokoBotIntegrationProvider,
  isSokoBotEmailProvider,
  SOKO_BOT_INTEGRATION_PROVIDERS,
  SOKO_BOT_POPULAR_TOOLKITS,
  type SokoBotCalendarEvent,
  type SokoBotInboxMessage,
  type SokoBotInboxMessageDetail,
  type SokoBotIntegrationProvider,
} from "@sokosumi/soko-bot";

import { getComposio } from "@/clients/composio.client";
import prisma from "@/lib/db/prisma";

export class SokoBotIntegrationError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_CONFIGURED"
      | "NOT_FOUND"
      | "UNKNOWN_PROVIDER"
      | "UPSTREAM" = "UPSTREAM",
  ) {
    super(message);
  }
}

/** Composio "user id": one identity per bot so accounts never cross bots. */
export function composioEntityId(sokoBotId: string): string {
  return `sokobot:${sokoBotId}`;
}

/** Any failure talking to Composio surfaces with its message instead of a 500. */
async function withComposio<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof SokoBotIntegrationError) throw error;
    const raw = error instanceof Error ? error.message : String(error);
    // The SDK embeds the API's JSON body; keep only its message.
    const json = raw.match(/\{.*\}$/s);
    let message = raw;
    if (json) {
      try {
        const parsed = JSON.parse(json[0]) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        // Not JSON after all; keep the raw text.
      }
    }
    throw new SokoBotIntegrationError(`Composio (${what}): ${message}`);
  }
}

function requireComposio() {
  const composio = getComposio();
  if (!composio) {
    throw new SokoBotIntegrationError(
      "Integrations are not configured on this environment",
      "NOT_CONFIGURED",
    );
  }
  return composio;
}

const SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/;

/** Known providers carry ingest kinds; any other Composio toolkit is generic. */
function resolveProvider(id: string): SokoBotIntegrationProvider {
  const slug = id.trim().toLowerCase();
  const known = getSokoBotIntegrationProvider(slug);
  if (known) return known;
  if (!SLUG_PATTERN.test(slug)) {
    throw new SokoBotIntegrationError("Unknown provider", "UNKNOWN_PROVIDER");
  }
  return { id: slug, name: slug, kinds: [], tools: {} };
}

export interface SokoBotIntegrationCatalogEntry {
  provider: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  kinds: readonly string[];
}

const CATALOG_TTL_MS = 60 * 60 * 1_000;
let catalogCache: {
  at: number;
  entries: SokoBotIntegrationCatalogEntry[];
} | null = null;

/** Composio's toolkit catalog by usage, cached for an hour and filtered locally. */
export async function searchSokoBotIntegrationCatalog(
  query: string,
  limit = 20,
): Promise<SokoBotIntegrationCatalogEntry[]> {
  const composio = getComposio();
  if (!composio) return curatedCatalog(query, limit);
  if (!catalogCache || Date.now() - catalogCache.at > CATALOG_TTL_MS) {
    const toolkits = await composio.toolkits
      .get({ sortBy: "usage", limit: 500 })
      .catch(() => null);
    if (!toolkits) return curatedCatalog(query, limit);
    catalogCache = {
      at: Date.now(),
      entries: toolkits
        .filter((toolkit) => toolkit.slug.toLowerCase() !== "composio")
        .map((toolkit) => ({
          provider: toolkit.slug.toLowerCase(),
          name: toolkit.name,
          description: toolkit.meta?.description ?? null,
          logoUrl: toolkit.meta?.logo ?? null,
          kinds:
            getSokoBotIntegrationProvider(toolkit.slug.toLowerCase())?.kinds ??
            [],
        })),
    };
  }
  const needle = query.trim().toLowerCase();
  const entries = needle
    ? catalogCache.entries.filter(
        (entry) =>
          entry.provider.includes(needle) ||
          entry.name.toLowerCase().includes(needle) ||
          (entry.description?.toLowerCase().includes(needle) ?? false),
      )
    : catalogCache.entries;
  return entries.slice(0, limit);
}

let featuredLogos: { at: number; logos: Map<string, string> } | null = null;

/** Toolkit logos by slug: the cached catalog plus direct lookups for the featured providers. */
async function catalogLogos(): Promise<Map<string, string>> {
  const entries = await searchSokoBotIntegrationCatalog("", 500).catch(
    () => [] as SokoBotIntegrationCatalogEntry[],
  );
  const logos = new Map(
    entries.flatMap((entry) =>
      entry.logoUrl ? [[entry.provider, entry.logoUrl] as const] : [],
    ),
  );
  const composio = getComposio();
  if (!composio) return logos;
  if (!featuredLogos || Date.now() - featuredLogos.at > CATALOG_TTL_MS) {
    const found = new Map<string, string>();
    await Promise.all(
      SOKO_BOT_INTEGRATION_PROVIDERS.map(async (provider) => {
        const toolkit = await composio.toolkits
          .get(provider.id)
          .catch(() => null);
        if (toolkit?.meta?.logo) found.set(provider.id, toolkit.meta.logo);
      }),
    );
    featuredLogos = { at: Date.now(), logos: found };
  }
  for (const [slug, logo] of featuredLogos.logos) logos.set(slug, logo);
  return logos;
}

function curatedCatalog(
  query: string,
  limit: number,
): SokoBotIntegrationCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  return SOKO_BOT_POPULAR_TOOLKITS.filter(
    (toolkit) =>
      !needle ||
      toolkit.id.includes(needle) ||
      toolkit.name.toLowerCase().includes(needle),
  )
    .slice(0, limit)
    .map((toolkit) => ({
      provider: toolkit.id,
      name: toolkit.name,
      description: null,
      logoUrl: null,
      kinds: [],
    }));
}

async function lookupToolkit(
  slug: string,
): Promise<{ name: string; logoUrl: string | null }> {
  const composio = requireComposio();
  try {
    const toolkit = await composio.toolkits.get(slug);
    return { name: toolkit.name, logoUrl: toolkit.meta?.logo ?? null };
  } catch {
    return {
      name: getSokoBotIntegrationProvider(slug)?.name ?? slug,
      logoUrl: null,
    };
  }
}

async function requireBot(userId: string, workspaceId: string) {
  const bot = await prisma.sokoBot.findFirst({
    where: { userId, workspaceId, archivedAt: null },
    select: { id: true },
  });
  if (!bot)
    throw new SokoBotIntegrationError("Soko Bot not found", "NOT_FOUND");
  return bot;
}

const INTEGRATION_SELECT = {
  id: true,
  provider: true,
  name: true,
  logoUrl: true,
  status: true,
  connectedAt: true,
  lastIngestAt: true,
  lastError: true,
} satisfies Prisma.SokoBotIntegrationSelect;

export interface SokoBotIntegrationView {
  provider: string;
  name: string;
  logoUrl: string | null;
  kinds: readonly string[];
  status: "DISCONNECTED" | "PENDING" | "ACTIVE" | "FAILED" | "REVOKED";
  connectedAt: Date | null;
  lastIngestAt: Date | null;
  lastError: string | null;
}

/** Every provider, with the bot's connection state; disconnected ones too. */
export async function listSokoBotIntegrations(
  userId: string,
  workspaceId: string,
): Promise<{ configured: boolean; integrations: SokoBotIntegrationView[] }> {
  const bot = await requireBot(userId, workspaceId);
  const rows = await prisma.sokoBotIntegration.findMany({
    where: { sokoBotId: bot.id },
    select: INTEGRATION_SELECT,
  });
  const logos = await catalogLogos();
  const connected: SokoBotIntegrationView[] = rows.map((row) => {
    const known = getSokoBotIntegrationProvider(row.provider);
    return {
      provider: row.provider,
      name: row.name ?? known?.name ?? row.provider,
      logoUrl: row.logoUrl ?? logos.get(row.provider) ?? null,
      kinds: known?.kinds ?? [],
      status: row.status,
      connectedAt: row.connectedAt,
      lastIngestAt: row.lastIngestAt,
      lastError: row.lastError,
    };
  });
  // Mail and calendar providers are always offered; everything else comes
  // from the catalog search.
  const featured: SokoBotIntegrationView[] =
    SOKO_BOT_INTEGRATION_PROVIDERS.filter(
      (provider) => !rows.some((row) => row.provider === provider.id),
    ).map((provider) => ({
      provider: provider.id,
      name: provider.name,
      logoUrl: null,
      kinds: provider.kinds,
      status: "DISCONNECTED",
      connectedAt: null,
      lastIngestAt: null,
      lastError: null,
    }));
  return {
    configured: getComposio() !== null,
    integrations: [...connected, ...featured],
  };
}

/** Composio-managed auth config per toolkit, created on first use. */
async function ensureAuthConfigId(toolkit: string): Promise<string> {
  const composio = requireComposio();
  const existing = await composio.authConfigs.list({ toolkit });
  const managed = existing.items.find(
    (item) =>
      item.toolkit.slug.toLowerCase() === toolkit && item.isComposioManaged,
  );
  if (managed) return managed.id;
  const created = await composio.authConfigs.create(toolkit, {
    type: "use_composio_managed_auth",
    name: `sokosumi-${toolkit}`,
  });
  return created.id;
}

/** Starts OAuth; the owner is sent to `redirectUrl` and comes back to `returnUrl`. */
export async function connectSokoBotIntegration(input: {
  userId: string;
  workspaceId: string;
  provider: string;
  returnUrl: string;
}): Promise<{ redirectUrl: string }> {
  const provider = resolveProvider(input.provider);
  const bot = await requireBot(input.userId, input.workspaceId);
  const composio = requireComposio();
  const toolkit = await lookupToolkit(provider.id);
  const authConfigId = await withComposio("auth config", () =>
    ensureAuthConfigId(provider.id),
  );
  const request = await withComposio("start OAuth", () =>
    composio.connectedAccounts.link(composioEntityId(bot.id), authConfigId, {
      callbackUrl: input.returnUrl,
      allowMultiple: false,
    }),
  );
  const previous = await prisma.sokoBotIntegration.findUnique({
    where: { sokoBotId_provider: { sokoBotId: bot.id, provider: provider.id } },
    select: { composioAccountId: true, status: true },
  });
  if (previous && previous.composioAccountId !== request.id) {
    await composio.connectedAccounts
      .delete(previous.composioAccountId)
      .catch(() => undefined);
  }
  await prisma.sokoBotIntegration.upsert({
    where: { sokoBotId_provider: { sokoBotId: bot.id, provider: provider.id } },
    create: {
      sokoBotId: bot.id,
      provider: provider.id,
      name: toolkit.name,
      logoUrl: toolkit.logoUrl,
      composioAccountId: request.id,
      status: "PENDING",
    },
    update: {
      composioAccountId: request.id,
      name: toolkit.name,
      logoUrl: toolkit.logoUrl,
      status: "PENDING",
      lastError: null,
    },
  });
  if (!request.redirectUrl) {
    throw new SokoBotIntegrationError("Composio returned no redirect URL");
  }
  return { redirectUrl: request.redirectUrl };
}

/** After the OAuth round-trip: ask Composio whether the account is live. */
export async function finalizeSokoBotIntegration(input: {
  userId: string;
  workspaceId: string;
  provider: string;
}): Promise<SokoBotIntegrationView["status"]> {
  const provider = resolveProvider(input.provider);
  const bot = await requireBot(input.userId, input.workspaceId);
  const row = await prisma.sokoBotIntegration.findUnique({
    where: { sokoBotId_provider: { sokoBotId: bot.id, provider: provider.id } },
    select: { id: true, composioAccountId: true },
  });
  if (!row) throw new SokoBotIntegrationError("Not connected", "NOT_FOUND");
  const composio = requireComposio();
  const account = await withComposio("account status", () =>
    composio.connectedAccounts.get(row.composioAccountId),
  );
  const status =
    account.status === "ACTIVE"
      ? "ACTIVE"
      : account.status === "INITIALIZING" || account.status === "INITIATED"
        ? "PENDING"
        : account.status === "REVOKED"
          ? "REVOKED"
          : "FAILED";
  await prisma.sokoBotIntegration.update({
    where: { id: row.id },
    data: {
      status,
      connectedAt: status === "ACTIVE" ? new Date() : undefined,
      lastError:
        status === "FAILED" || status === "REVOKED"
          ? (account.statusReason ?? account.status)
          : null,
    },
  });
  return status;
}

export async function disconnectSokoBotIntegration(input: {
  userId: string;
  workspaceId: string;
  provider: string;
}): Promise<void> {
  const provider = resolveProvider(input.provider);
  const bot = await requireBot(input.userId, input.workspaceId);
  const row = await prisma.sokoBotIntegration.findUnique({
    where: { sokoBotId_provider: { sokoBotId: bot.id, provider: provider.id } },
    select: { id: true, composioAccountId: true },
  });
  if (!row) return;
  const composio = getComposio();
  if (composio) {
    await composio.connectedAccounts
      .delete(row.composioAccountId)
      .catch(() => undefined);
  }
  await prisma.sokoBotIntegration.delete({ where: { id: row.id } });
}

// ---------------------------------------------------------------------------
// Reading data through Composio tools, normalised per provider.
// ---------------------------------------------------------------------------

interface ActiveIntegration {
  id: string;
  sokoBotId: string;
  provider: SokoBotIntegrationProvider;
  composioAccountId: string;
  cursor: Prisma.JsonValue | null;
}

export async function activeIntegrationsForBot(
  sokoBotId: string,
  kind?: "email" | "calendar" | "generic",
  providerId?: string,
): Promise<ActiveIntegration[]> {
  const rows = await prisma.sokoBotIntegration.findMany({
    where: {
      sokoBotId,
      status: "ACTIVE",
      ...(providerId ? { provider: providerId } : {}),
    },
    select: {
      id: true,
      sokoBotId: true,
      provider: true,
      composioAccountId: true,
      cursor: true,
    },
  });
  return rows.flatMap((row) => {
    const provider = resolveProvider(row.provider);
    if (kind === "generic") {
      if (isSokoBotEmailProvider(provider.id)) return [];
    } else if (kind && !provider.kinds.includes(kind)) {
      return [];
    }
    return [{ ...row, provider }];
  });
}

export interface SokoBotIntegrationTool {
  slug: string;
  name: string;
  description: string | null;
  inputSchema: unknown;
}

/** Tool descriptors of one toolkit, optionally narrowed by intent words. */
export async function listIntegrationTools(
  integration: ActiveIntegration,
  options: { query?: string; limit: number },
): Promise<SokoBotIntegrationTool[]> {
  const composio = requireComposio();
  const tools = await withComposio("list tools", () =>
    composio.tools.getRawComposioTools({
      toolkits: [integration.provider.id],
      search: options.query?.trim() || undefined,
      limit: options.limit,
    }),
  );
  return tools.map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    description: tool.description ?? null,
    inputSchema: tool.inputParameters ?? null,
  }));
}

/** Runs one toolkit tool as the connected account; mailboxes are refused. */
export async function runIntegrationTool(
  integration: ActiveIntegration,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (isSokoBotEmailProvider(integration.provider.id)) {
    throw new SokoBotIntegrationError(
      "Mailboxes are read through search_inbox and read_email only",
    );
  }
  const slug = tool.trim().toUpperCase();
  const prefix = `${integration.provider.id.toUpperCase()}_`;
  if (!slug.startsWith(prefix)) {
    throw new SokoBotIntegrationError(
      `Tool ${tool} does not belong to ${integration.provider.name}`,
    );
  }
  return execute(integration, slug, args);
}

async function execute(
  integration: ActiveIntegration,
  slug: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const composio = requireComposio();
  const result = await withComposio(slug, () =>
    composio.tools.execute(slug, {
      userId: composioEntityId(integration.sokoBotId),
      connectedAccountId: integration.composioAccountId,
      arguments: args,
    }),
  );
  if (!result.successful) {
    throw new SokoBotIntegrationError(
      `${integration.provider.name}: ${result.error ?? "request failed"}`,
    );
  }
  return result.data;
}

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function addressList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return asList(value).map((entry) => {
    const email = pick(entry, "emailAddress", "email", "address");
    if (email && typeof email === "object") {
      const name = str(pick(email, "name"));
      const address = str(pick(email, "address", "email"));
      return name ? `${name} <${address}>` : address;
    }
    return str(email ?? entry);
  });
}

function isoOrEmpty(value: unknown): string {
  if (typeof value === "number") return new Date(value).toISOString();
  const text = str(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function normaliseMessage(
  providerId: string,
  raw: unknown,
): SokoBotInboxMessage {
  const from = pick(raw, "sender", "from");
  const fromText =
    from && typeof from === "object"
      ? (addressList([from])[0] ?? "")
      : str(from);
  const labels = asList(pick(raw, "labelIds", "categories")).map(str);
  const isRead = pick(raw, "isRead");
  return {
    provider: providerId,
    id: str(pick(raw, "messageId", "id")),
    threadId: str(pick(raw, "threadId", "conversationId")) || null,
    from: fromText,
    to: addressList(pick(raw, "to", "toRecipients")),
    subject: str(pick(raw, "subject")),
    snippet: str(pick(raw, "preview", "snippet", "bodyPreview")).slice(0, 400),
    receivedAt: isoOrEmpty(
      pick(raw, "messageTimestamp", "receivedDateTime", "internalDate", "date"),
    ),
    unread: typeof isRead === "boolean" ? !isRead : labels.includes("UNREAD"),
    labels,
  };
}

function normaliseEvent(
  providerId: string,
  raw: unknown,
): SokoBotCalendarEvent {
  const start = pick(raw, "start");
  const end = pick(raw, "end");
  const startDate = str(pick(start, "dateTime", "date")) || str(start);
  const endDate = str(pick(end, "dateTime", "date")) || str(end);
  const allDay = Boolean(pick(start, "date")) || Boolean(pick(raw, "isAllDay"));
  return {
    provider: providerId,
    id: str(pick(raw, "id")),
    title: str(pick(raw, "summary", "subject", "title")) || "(no title)",
    startsAt: isoOrEmpty(startDate),
    endsAt: isoOrEmpty(endDate) || null,
    allDay,
    location:
      str(pick(raw, "location")) ||
      str(pick(pick(raw, "location"), "displayName")) ||
      null,
    attendees: addressList(pick(raw, "attendees")).slice(0, 20),
    organizer: addressList([pick(raw, "organizer")])[0] || null,
    description:
      str(pick(raw, "description", "bodyPreview")).slice(0, 500) || null,
    link: str(pick(raw, "htmlLink", "webLink")) || null,
  };
}

export async function fetchInboxMessages(
  integration: ActiveIntegration,
  options: {
    since?: Date;
    query?: string;
    unreadOnly?: boolean;
    limit: number;
  },
): Promise<SokoBotInboxMessage[]> {
  const slug = integration.provider.tools.listMessages;
  if (!slug) return [];
  const args: Record<string, unknown> = { max_results: options.limit };
  if (integration.provider.id === "gmail") {
    const parts = [options.query ?? ""];
    if (options.since)
      parts.push(`after:${Math.floor(options.since.getTime() / 1000)}`);
    if (options.unreadOnly) parts.push("is:unread");
    args.query = parts.filter(Boolean).join(" ");
    args.include_payload = false;
    args.verbose = false;
  } else {
    const filters: string[] = [];
    if (options.since)
      filters.push(`receivedDateTime ge ${options.since.toISOString()}`);
    if (options.unreadOnly) filters.push("isRead eq false");
    if (filters.length) args.filter = filters.join(" and ");
    if (options.query) args.search = options.query;
    args.top = options.limit;
    args.orderby = "receivedDateTime desc";
  }
  const data = await execute(integration, slug, args);
  const items = asList(pick(data, "messages", "value", "items", "data"));
  return items
    .map((item) => normaliseMessage(integration.provider.id, item))
    .filter((message) => message.id);
}

export async function fetchInboxMessage(
  integration: ActiveIntegration,
  messageId: string,
): Promise<SokoBotInboxMessageDetail> {
  const slug = integration.provider.tools.getMessage;
  if (!slug) throw new SokoBotIntegrationError("Provider cannot read mail");
  const args =
    integration.provider.id === "gmail"
      ? { message_id: messageId, format: "full" }
      : { message_id: messageId };
  const data = await execute(integration, slug, args);
  const raw = pick(data, "message", "data") ?? data;
  const body =
    str(pick(raw, "messageText", "text")) ||
    str(pick(pick(raw, "body"), "content")) ||
    str(pick(raw, "body", "snippet"));
  return {
    ...normaliseMessage(integration.provider.id, raw),
    body: body.slice(0, 20_000),
  };
}

export async function fetchCalendarEvents(
  integration: ActiveIntegration,
  options: { from: Date; to: Date; limit: number },
): Promise<SokoBotCalendarEvent[]> {
  const slug = integration.provider.tools.listEvents;
  if (!slug) return [];
  const args: Record<string, unknown> =
    integration.provider.id === "googlecalendar"
      ? {
          calendar_id: "primary",
          timeMin: options.from.toISOString(),
          timeMax: options.to.toISOString(),
          single_events: true,
          order_by: "startTime",
          max_results: options.limit,
        }
      : {
          start_datetime: options.from.toISOString(),
          end_datetime: options.to.toISOString(),
          top: options.limit,
        };
  const data = await execute(integration, slug, args);
  const items = asList(pick(data, "event_data", "events", "items", "value"));
  const events = items
    .map((item) => normaliseEvent(integration.provider.id, item))
    .filter((event) => event.id && event.startsAt);
  events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return events;
}
