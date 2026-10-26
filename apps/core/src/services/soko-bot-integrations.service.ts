import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  ComposioToolkitNotFoundError,
  ComposioToolNotFoundError,
} from "@composio/core";
import type { Prisma } from "@sokosumi/database";
import {
  getSokoBotIntegrationProvider,
  isSokoBotEmailProvider,
  SOKO_BOT_POPULAR_TOOLKITS,
  type SokoBotCalendarEvent,
  type SokoBotInboxAttachment,
  type SokoBotInboxMessage,
  type SokoBotInboxMessageDetail,
  type SokoBotIntegrationProvider,
} from "@sokosumi/soko-bot";

import { getComposio } from "@/clients/composio.client";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

export class SokoBotIntegrationError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "IDENTITY_MISMATCH"
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

function isComposioMissingResource(error: unknown): boolean {
  return (
    error instanceof ComposioToolNotFoundError ||
    error instanceof ComposioToolkitNotFoundError
  );
}

/** Any failure talking to Composio surfaces with its message instead of a 500. */
export async function withComposio<T>(
  what: string,
  fn: () => Promise<T>,
): Promise<T> {
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
    throw new SokoBotIntegrationError(
      `Composio (${what}): ${message}`,
      isComposioMissingResource(error) ? "NOT_FOUND" : "UPSTREAM",
    );
  }
}

export function requireComposio() {
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
export function resolveProvider(id: string): SokoBotIntegrationProvider {
  const slug = id.trim().toLowerCase();
  const known = getSokoBotIntegrationProvider(slug);
  if (known) return known;
  if (!SLUG_PATTERN.test(slug)) {
    throw new SokoBotIntegrationError("Unknown provider", "UNKNOWN_PROVIDER");
  }
  return {
    id: slug,
    name: slug,
    kinds: [],
    tools: {},
    logoUrl: `https://logos.composio.dev/api/${slug}`,
  };
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

/** Toolkit logos by slug from the cached catalog; empty when unreachable. */
export async function catalogLogos(): Promise<Map<string, string>> {
  const entries = await searchSokoBotIntegrationCatalog("", 500).catch(
    () => [] as SokoBotIntegrationCatalogEntry[],
  );
  return new Map(
    entries.flatMap((entry) =>
      entry.logoUrl ? [[entry.provider, entry.logoUrl] as const] : [],
    ),
  );
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

/** Revoke the account snapshot captured atomically during bot deletion. */
export async function revokeSokoBotIntegrationAccounts(
  sokoBotId: string,
  rows: {
    provider: string;
    composioAccountId: string;
    pendingComposioAccountId: string | null;
  }[],
): Promise<{ revoked: number; failed: string[] }> {
  if (rows.length === 0) return { revoked: 0, failed: [] };
  const composio = getComposio();
  if (!composio) return { revoked: 0, failed: rows.map((r) => r.provider) };

  const failed = new Set<string>();
  for (const row of rows) {
    for (const accountId of new Set([
      row.composioAccountId,
      row.pendingComposioAccountId,
    ])) {
      if (!accountId) continue;
      try {
        await composio.connectedAccounts.delete(accountId);
      } catch (error) {
        failed.add(row.provider);
        console.error("Soko Bot integration revoke failed", {
          sokoBotId,
          provider: row.provider,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }
  return { revoked: rows.length - failed.size, failed: [...failed] };
}

// ---------------------------------------------------------------------------
// Reading data through Composio tools, normalised per provider.
// ---------------------------------------------------------------------------

export interface ActiveIntegration {
  id: string;
  sokoBotId: string;
  provider: SokoBotIntegrationProvider;
  composioAccountId: string;
  /** The member who connected it; `null` on a personal bot means its owner. */
  connectorUserId: string | null;
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
      connectorUserId: true,
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

/** A Composio call the model is waiting on; well under the turn budget. */
const COMPOSIO_TIMEOUT_MS = 45_000;

async function executeViaRest(
  integration: ActiveIntegration,
  slug: string,
  args: Record<string, unknown>,
): Promise<{
  successful: boolean;
  error: string | null;
  data: Record<string, unknown>;
}> {
  const env = getEnv();
  const base = (
    env.COMPOSIO_API_BASE_URL ?? "https://backend.composio.dev"
  ).replace(/\/$/, "");
  const response = await fetch(
    `${base}/api/v3/tools/execute/${encodeURIComponent(slug)}`,
    {
      method: "POST",
      headers: {
        "x-api-key": env.COMPOSIO_API_KEY ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user_id: composioEntityId(integration.sokoBotId),
        connected_account_id: integration.composioAccountId,
        arguments: args,
        version: "latest",
      }),
      // Every other external call in Core is bounded; this one was not, and it
      // is the only unbounded I/O a tool call can reach. A provider that never
      // answers held the whole turn open until the invocation was killed, which
      // leaves the turn RUNNING and the chat on "Thinking…".
      signal: AbortSignal.timeout(COMPOSIO_TIMEOUT_MS),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    successful?: boolean;
    error?: string | { message?: string } | null;
    data?: Record<string, unknown>;
  };
  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? body.error
        : (body.error?.message ?? `HTTP ${response.status}`);
    throw new SokoBotIntegrationError(`Composio (${slug}): ${message}`);
  }
  return {
    successful: body.successful ?? false,
    error:
      typeof body.error === "string"
        ? body.error
        : (body.error?.message ?? null),
    data: body.data ?? {},
  };
}

/**
 * Lab seam: `SOKO_BOT_INTEGRATION_FIXTURES=record` writes every Composio
 * tool response to disk; `replay` answers from disk and refuses calls that
 * were never recorded. Keys drop time-window arguments so a recording made
 * today still matches tomorrow's request.
 */
function fixtureMode(): "record" | "replay" | null {
  const mode = process.env.SOKO_BOT_INTEGRATION_FIXTURES;
  return mode === "record" || mode === "replay" ? mode : null;
}

function fixtureDir(): string {
  return (
    process.env.SOKO_BOT_INTEGRATION_FIXTURE_DIR ??
    path.join(process.cwd(), "fixtures", "soko-bot-integrations")
  );
}

const TIME_ARGS = new Set([
  "timeMin",
  "timeMax",
  "start_datetime",
  "end_datetime",
  "filter",
]);

function fixtureKey(slug: string, args: Record<string, unknown>): string {
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(args).sort()) {
    if (TIME_ARGS.has(key)) continue;
    const value = args[key];
    stable[key] =
      key === "query" && typeof value === "string"
        ? value.replace(/after:\d+/g, "after:*").trim()
        : value;
  }
  const hash = createHash("sha1")
    .update(JSON.stringify(stable))
    .digest("hex")
    .slice(0, 10);
  return `${slug}.${hash}`;
}

async function execute(
  integration: ActiveIntegration,
  slug: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const mode = fixtureMode();
  const key = fixtureKey(slug, args);
  const file = path.join(fixtureDir(), `${key}.json`);
  if (mode === "replay") {
    try {
      const recorded = JSON.parse(await fs.readFile(file, "utf8")) as {
        data: Record<string, unknown>;
      };
      return recorded.data;
    } catch {
      // A listing may fall back to any recording of the same tool — the bot
      // phrases queries freely — but fetching one id must not, or replay
      // would hand back a different message than the one asked for.
      const strict = slug === integration.provider.tools.getMessage;
      const siblings = strict
        ? []
        : await fs.readdir(fixtureDir()).catch(() => []);
      const sibling = siblings.find((name) => name.startsWith(`${slug}.`));
      if (sibling) {
        const recorded = JSON.parse(
          await fs.readFile(path.join(fixtureDir(), sibling), "utf8"),
        ) as { data: Record<string, unknown> };
        return recorded.data;
      }
      throw new SokoBotIntegrationError(
        `No recording for ${slug} (${key}); run the lab with --record first`,
      );
    }
  }
  requireComposio();
  // The SDK refuses `version: "latest"` for manual execution; the REST API
  // accepts it, so call it directly with the same key.
  const result = await withComposio(slug, () =>
    executeViaRest(integration, slug, args),
  );
  if (!result.successful) {
    throw new SokoBotIntegrationError(
      `${integration.provider.name}: ${result.error ?? "request failed"}`,
    );
  }
  if (mode === "record") {
    await fs.mkdir(fixtureDir(), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify(
        { slug, args, recordedAt: new Date().toISOString(), data: result.data },
        null,
        2,
      ),
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
    snippet: (
      str(pick(pick(raw, "preview"), "body")) ||
      str(pick(raw, "preview", "snippet", "bodyPreview")) ||
      str(pick(raw, "messageText"))
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400),
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

/** Gmail's label ids for what the inbox tools change. */
const GMAIL_LABEL = { unread: "UNREAD", inbox: "INBOX" } as const;

function requireMailTool(
  integration: ActiveIntegration,
  tool: "modifyMessages" | "createDraft" | "sendDraft" | "getAttachment",
): string {
  const slug = integration.provider.tools[tool];
  if (!slug)
    throw new SokoBotIntegrationError(
      `${integration.provider.name} mail can only be read for now`,
    );
  return slug;
}

/**
 * Marks mail read or unread and archives it, in the owner's mailbox. Only
 * the changes asked for are made; nothing is sent or deleted.
 */
export async function modifyInboxMessages(
  integration: ActiveIntegration,
  messageIds: readonly string[],
  change: { read?: boolean; archive?: boolean },
): Promise<void> {
  if (messageIds.length === 0) return;
  const slug = requireMailTool(integration, "modifyMessages");
  const addLabelIds: string[] = [];
  const removeLabelIds: string[] = [];
  if (change.read === true) removeLabelIds.push(GMAIL_LABEL.unread);
  if (change.read === false) addLabelIds.push(GMAIL_LABEL.unread);
  if (change.archive) removeLabelIds.push(GMAIL_LABEL.inbox);
  if (addLabelIds.length === 0 && removeLabelIds.length === 0) return;
  await execute(integration, slug, {
    messageIds: [...messageIds],
    ...(addLabelIds.length ? { addLabelIds } : {}),
    ...(removeLabelIds.length ? { removeLabelIds } : {}),
  });
}

/** Writes a draft in the owner's mailbox; nothing is sent. Returns its id. */
export async function createInboxDraft(
  integration: ActiveIntegration,
  draft: {
    to: readonly string[];
    cc?: readonly string[];
    subject: string;
    body: string;
    threadId?: string;
  },
): Promise<string> {
  const slug = requireMailTool(integration, "createDraft");
  const [first, ...rest] = draft.to;
  const data = await execute(integration, slug, {
    ...(first ? { recipient_email: first } : {}),
    ...(rest.length ? { extra_recipients: rest } : {}),
    ...(draft.cc?.length ? { cc: [...draft.cc] } : {}),
    // A reply keeps the thread's subject; a subject would start a new one.
    ...(draft.threadId
      ? { thread_id: draft.threadId }
      : { subject: draft.subject }),
    body: draft.body,
  });
  const draftId =
    str(pick(data, "draft_id", "id")) ||
    str(pick(pick(data, "draft", "data"), "id"));
  if (!draftId)
    throw new SokoBotIntegrationError("The mailbox did not return a draft id");
  return draftId;
}

/** Sends a draft that is already in the owner's mailbox. */
export async function sendInboxDraft(
  integration: ActiveIntegration,
  draftId: string,
): Promise<void> {
  await execute(integration, requireMailTool(integration, "sendDraft"), {
    draft_id: draftId,
  });
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
  return (await fetchInboxPage(integration, options)).messages;
}

/**
 * One page of mail, newest first. Gmail hands back a page token; Outlook
 * pages by offset, so its token is the next `skip`. `raw` is the provider's
 * own items, for readers that need headers or recipients the normalised
 * shape leaves out (contact capture).
 */
export async function fetchInboxPage(
  integration: ActiveIntegration,
  options: {
    since?: Date;
    before?: Date;
    query?: string;
    unreadOnly?: boolean;
    /** Outlook folder; Gmail selects folders in `query` (`in:sent`). */
    folder?: "sentitems";
    /** Gmail: include the headers (List-Unsubscribe, Cc, …). */
    includePayload?: boolean;
    limit: number;
    pageToken?: string;
  },
): Promise<{
  messages: SokoBotInboxMessage[];
  raw: unknown[];
  nextPageToken: string | null;
}> {
  const slug = integration.provider.tools.listMessages;
  if (!slug) return { messages: [], raw: [], nextPageToken: null };
  const gmail = integration.provider.id === "gmail";
  const args: Record<string, unknown> = { max_results: options.limit };
  if (gmail) {
    const parts = [options.query ?? ""];
    if (options.since)
      parts.push(`after:${Math.floor(options.since.getTime() / 1000)}`);
    if (options.before)
      parts.push(`before:${Math.floor(options.before.getTime() / 1000)}`);
    if (options.unreadOnly) parts.push("is:unread");
    args.query = parts.filter(Boolean).join(" ");
    args.include_payload = options.includePayload ?? false;
    args.verbose = false;
    if (options.pageToken) args.page_token = options.pageToken;
  } else if (options.query) {
    // Graph refuses $search next to $filter or $orderby, and wants it quoted;
    // results come newest first, and since/unread are applied below.
    args.search = `"${options.query.replaceAll('"', "")}"`;
    args.top = options.limit;
  } else {
    const filters: string[] = [];
    if (options.since)
      filters.push(`receivedDateTime ge ${options.since.toISOString()}`);
    if (options.before)
      filters.push(`receivedDateTime lt ${options.before.toISOString()}`);
    if (options.unreadOnly) filters.push("isRead eq false");
    if (filters.length) args.filter = filters.join(" and ");
    args.top = options.limit;
    args.orderby = "receivedDateTime desc";
    if (options.folder) args.folder = options.folder;
    if (options.pageToken) args.skip = Number(options.pageToken) || 0;
  }
  const data = await execute(integration, slug, args);
  const items = asList(pick(data, "messages", "value", "items", "data"));
  const searched = !gmail && !!options.query;
  const messages = items
    .map((item) => normaliseMessage(integration.provider.id, item))
    .filter(
      (message) =>
        message.id &&
        (!searched ||
          ((!options.since ||
            message.receivedAt >= options.since.toISOString()) &&
            (!options.unreadOnly || message.unread))),
    );
  const nextPageToken = gmail
    ? str(pick(data, "nextPageToken", "next_page_token")) || null
    : !searched && items.length >= options.limit
      ? String((Number(options.pageToken) || 0) + items.length)
      : null;
  return { messages, raw: items, nextPageToken };
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
    attachments: messageAttachments(raw),
  };
}

function attachmentOf(entry: unknown): SokoBotInboxAttachment | null {
  const id = str(
    pick(entry, "attachmentId", "attachment_id") ??
      pick(pick(entry, "body"), "attachmentId"),
  );
  const filename = str(pick(entry, "filename", "fileName", "name"));
  if (!id || !filename) return null;
  const size = Number(pick(entry, "size") ?? pick(pick(entry, "body"), "size"));
  return {
    id,
    filename,
    mimeType:
      str(pick(entry, "mimeType", "mimetype", "contentType")) ||
      "application/octet-stream",
    size: Number.isFinite(size) && size > 0 ? size : null,
  };
}

/** Gmail lists attachments in `attachmentList`, and always in the payload's parts. */
function messageAttachments(raw: unknown): SokoBotInboxAttachment[] {
  const found = new Map<string, SokoBotInboxAttachment>();
  const add = (entry: unknown) => {
    const attachment = attachmentOf(entry);
    if (attachment && !found.has(attachment.id))
      found.set(attachment.id, attachment);
  };
  asList(pick(raw, "attachmentList", "attachments")).forEach(add);
  const walk = (part: unknown, depth: number) => {
    if (depth > 8) return;
    add(part);
    for (const child of asList(pick(part, "parts"))) walk(child, depth + 1);
  };
  walk(pick(raw, "payload"), 0);
  return [...found.values()];
}

/** Mail attachments a bot may save; Gmail's own limit is 25 MB. */
export const INBOX_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

function base64Bytes(value: string): Buffer | null {
  const text = value.replace(/^data:[^,]*,/, "").trim();
  if (!text || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) return null;
  return Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function downloadBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok)
    throw new SokoBotIntegrationError(
      `The attachment download failed (HTTP ${response.status})`,
    );
  const declared = Number(response.headers.get("content-length"));
  if (declared > INBOX_ATTACHMENT_MAX_BYTES)
    throw new SokoBotIntegrationError("The attachment is larger than 25 MB");
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The bytes of one attachment. Composio documents the result only as
 * `data`, so a file link (`s3url`/`url`) and inline base64 are both read.
 */
export async function fetchInboxAttachment(
  integration: ActiveIntegration,
  input: { messageId: string; attachmentId: string; filename: string },
): Promise<Buffer> {
  const slug = requireMailTool(integration, "getAttachment");
  const data = await execute(integration, slug, {
    message_id: input.messageId,
    attachment_id: input.attachmentId,
    file_name: input.filename,
  });
  const candidates = [data, pick(data, "file", "data", "attachment")];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      if (/^https:\/\//.test(candidate)) return downloadBytes(candidate);
      const bytes = base64Bytes(candidate);
      if (bytes) return bytes;
      continue;
    }
    const url = str(pick(candidate, "s3url", "s3_url", "url", "downloadUrl"));
    if (/^https:\/\//.test(url)) return downloadBytes(url);
    const inline = str(pick(candidate, "data", "content", "base64"));
    const bytes = inline ? base64Bytes(inline) : null;
    if (bytes) return bytes;
  }
  console.warn("[soko-bot-mail] unreadable attachment result", {
    keys: data && typeof data === "object" ? Object.keys(data) : typeof data,
  });
  throw new SokoBotIntegrationError(
    "The mailbox returned the attachment in a form Sokosumi cannot read",
  );
}

export async function fetchCalendarEvents(
  integration: ActiveIntegration,
  options: { from: Date; to: Date; limit: number },
): Promise<SokoBotCalendarEvent[]> {
  const { events } = await fetchCalendarPage(integration, options);
  // A calendar is read inside the stand-up, meeting prep and briefings, not
  // by the hourly mail ingest, so the read itself records that it worked.
  try {
    await prisma.sokoBotIntegration.update({
      where: { id: integration.id },
      data: { lastIngestAt: new Date() },
    });
  } catch {
    // A missed stamp only affects the console tile, never the read itself.
  }
  return events;
}

/**
 * One page of events between `from` and `to`, in start order. Google hands
 * back a page token; Outlook pages by offset. `raw` keeps the provider's
 * attendee details (responses, rooms) for contact capture.
 */
export async function fetchCalendarPage(
  integration: ActiveIntegration,
  options: { from: Date; to: Date; limit: number; pageToken?: string },
): Promise<{
  events: SokoBotCalendarEvent[];
  raw: unknown[];
  nextPageToken: string | null;
}> {
  const slug = integration.provider.tools.listEvents;
  if (!slug) return { events: [], raw: [], nextPageToken: null };
  const google = integration.provider.id === "googlecalendar";
  const args: Record<string, unknown> = google
    ? {
        calendar_id: "primary",
        timeMin: options.from.toISOString(),
        timeMax: options.to.toISOString(),
        single_events: true,
        order_by: "startTime",
        max_results: options.limit,
        ...(options.pageToken ? { page_token: options.pageToken } : {}),
      }
    : {
        start_datetime: options.from.toISOString(),
        end_datetime: options.to.toISOString(),
        top: options.limit,
        ...(options.pageToken ? { skip: Number(options.pageToken) || 0 } : {}),
      };
  const data = await execute(integration, slug, args);
  const items = asList(pick(data, "event_data", "events", "items", "value"));
  const events = items
    .map((item) => normaliseEvent(integration.provider.id, item))
    .filter((event) => event.id && event.startsAt);
  events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const nextPageToken = google
    ? str(pick(data, "nextPageToken", "next_page_token")) || null
    : items.length >= options.limit
      ? String((Number(options.pageToken) || 0) + items.length)
      : null;
  return { events, raw: items, nextPageToken };
}
