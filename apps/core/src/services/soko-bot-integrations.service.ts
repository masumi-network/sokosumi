import type { Prisma } from "@sokosumi/database";
import {
  getSokoBotIntegrationProvider,
  SOKO_BOT_INTEGRATION_PROVIDERS,
  type SokoBotCalendarEvent,
  type SokoBotInboxMessage,
  type SokoBotInboxMessageDetail,
  type SokoBotIntegrationKind,
  type SokoBotIntegrationProvider,
} from "@sokosumi/soko-bot";
import {
  ConnectError,
  ConnectorInstallationRequiredError,
  type ConnectTokenParams,
  deleteTokenCacheEntry,
  getToken,
  getTokenResponse,
  NoValidTokenError,
  revokeToken,
  startAuthorization,
  UserAuthorizationRequiredError,
} from "@vercel/connect";

import { getEnv, getWebAppBaseUrl } from "@/config/env";
import prisma from "@/lib/db/prisma";

const GOOGLE_GMAIL_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_CALENDAR_BASE_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary";
const MICROSOFT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0/me";

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

export function vercelConnectSubjectId(sokoBotId: string): string {
  return `soko-bot:${sokoBotId}`;
}

function connectorUid(provider: SokoBotIntegrationProvider): string | null {
  const env = getEnv();
  if (provider.id === "google") {
    return env.SOKO_BOT_GOOGLE_CONNECTOR_UID ?? null;
  }
  return env.SOKO_BOT_MICROSOFT_CONNECTOR_UID ?? null;
}

function requireConnectorUid(provider: SokoBotIntegrationProvider): string {
  const uid = connectorUid(provider);
  if (!uid) {
    throw new SokoBotIntegrationError(
      `${provider.name} is not configured on this environment`,
      "NOT_CONFIGURED",
    );
  }
  return uid;
}

function requireProvider(id: string): SokoBotIntegrationProvider {
  const provider = getSokoBotIntegrationProvider(id);
  if (!provider) {
    throw new SokoBotIntegrationError("Unknown provider", "UNKNOWN_PROVIDER");
  }
  return provider;
}

function providerScopes(
  provider: SokoBotIntegrationProvider,
  kind?: SokoBotIntegrationKind,
): string[] {
  if (kind) return [...provider.scopes[kind]];
  return [...new Set([...provider.scopes.email, ...provider.scopes.calendar])];
}

function tokenParams(
  sokoBotId: string,
  provider: SokoBotIntegrationProvider,
  kind?: SokoBotIntegrationKind,
): ConnectTokenParams {
  return {
    subject: { type: "user", id: vercelConnectSubjectId(sokoBotId) },
    scopes: providerScopes(provider, kind),
  };
}

function integrationFailure(
  provider: SokoBotIntegrationProvider,
  error: unknown,
): SokoBotIntegrationError {
  if (error instanceof ConnectorInstallationRequiredError) {
    return new SokoBotIntegrationError(
      `${provider.name} needs an administrator installation before accounts can connect`,
    );
  }
  if (error instanceof UserAuthorizationRequiredError) {
    return new SokoBotIntegrationError(
      `${provider.name} authorization was not completed`,
    );
  }
  if (error instanceof ConnectError) {
    return new SokoBotIntegrationError(`Vercel Connect: ${error.message}`);
  }
  return new SokoBotIntegrationError(
    error instanceof Error ? error.message : `${provider.name} request failed`,
  );
}

async function requireBot(userId: string, workspaceId: string) {
  const bot = await prisma.sokoBot.findFirst({
    where: { userId, workspaceId, archivedAt: null },
    select: { id: true },
  });
  if (!bot) {
    throw new SokoBotIntegrationError("Soko Bot not found", "NOT_FOUND");
  }
  return bot;
}

const INTEGRATION_SELECT = {
  id: true,
  provider: true,
  status: true,
  connectedAt: true,
  lastIngestAt: true,
  lastError: true,
} satisfies Prisma.SokoBotIntegrationSelect;

export interface SokoBotIntegrationView {
  provider: string;
  name: string;
  kinds: readonly string[];
  available: boolean;
  status: "DISCONNECTED" | "PENDING" | "ACTIVE" | "FAILED" | "REVOKED";
  connectedAt: Date | null;
  lastIngestAt: Date | null;
  lastError: string | null;
}

export async function listSokoBotIntegrations(
  userId: string,
  workspaceId: string,
): Promise<{ configured: boolean; integrations: SokoBotIntegrationView[] }> {
  const bot = await requireBot(userId, workspaceId);
  const rows = await prisma.sokoBotIntegration.findMany({
    where: { sokoBotId: bot.id },
    select: INTEGRATION_SELECT,
  });
  const integrations = SOKO_BOT_INTEGRATION_PROVIDERS.map((provider) => {
    const row = rows.find((candidate) => candidate.provider === provider.id);
    return {
      provider: provider.id,
      name: provider.name,
      kinds: provider.kinds,
      available: connectorUid(provider) !== null,
      status: row?.status ?? ("DISCONNECTED" as const),
      connectedAt: row?.connectedAt ?? null,
      lastIngestAt: row?.lastIngestAt ?? null,
      lastError: row?.lastError ?? null,
    };
  });
  return {
    configured: integrations.some((integration) => integration.available),
    integrations,
  };
}

export async function connectSokoBotIntegration(input: {
  userId: string;
  workspaceId: string;
  provider: string;
}): Promise<{ redirectUrl: string }> {
  const provider = requireProvider(input.provider);
  const bot = await requireBot(input.userId, input.workspaceId);
  const callbackUrl = new URL(
    "/personal-assistant/integrations/return",
    getWebAppBaseUrl(),
  );
  callbackUrl.searchParams.set("provider", provider.id);
  try {
    const authorization = await startAuthorization(
      requireConnectorUid(provider),
      tokenParams(bot.id, provider),
      { callbackUrl: callbackUrl.toString() },
    );
    if (!authorization.url) {
      throw new SokoBotIntegrationError(
        "Vercel Connect returned no authorization URL",
      );
    }
    await prisma.sokoBotIntegration.upsert({
      where: {
        sokoBotId_provider: { sokoBotId: bot.id, provider: provider.id },
      },
      create: {
        sokoBotId: bot.id,
        provider: provider.id,
        status: "PENDING",
      },
      update: {
        status: "PENDING",
        connectedAt: null,
        lastError: null,
      },
    });
    return { redirectUrl: authorization.url };
  } catch (error) {
    if (error instanceof SokoBotIntegrationError) throw error;
    throw integrationFailure(provider, error);
  }
}

export async function finalizeSokoBotIntegration(input: {
  userId: string;
  workspaceId: string;
  provider: string;
}): Promise<SokoBotIntegrationView["status"]> {
  const provider = requireProvider(input.provider);
  const bot = await requireBot(input.userId, input.workspaceId);
  const row = await prisma.sokoBotIntegration.findUnique({
    where: { sokoBotId_provider: { sokoBotId: bot.id, provider: provider.id } },
    select: { id: true },
  });
  if (!row) {
    throw new SokoBotIntegrationError("Not connected", "NOT_FOUND");
  }
  try {
    await getTokenResponse(
      requireConnectorUid(provider),
      tokenParams(bot.id, provider),
      { forceRefresh: true },
    );
    await prisma.sokoBotIntegration.update({
      where: { id: row.id },
      data: { status: "ACTIVE", connectedAt: new Date(), lastError: null },
    });
    return "ACTIVE";
  } catch (error) {
    if (
      error instanceof UserAuthorizationRequiredError ||
      error instanceof ConnectorInstallationRequiredError
    ) {
      const failure = integrationFailure(provider, error);
      await prisma.sokoBotIntegration.update({
        where: { id: row.id },
        data: { status: "FAILED", lastError: failure.message },
      });
      return "FAILED";
    }
    if (error instanceof NoValidTokenError) {
      await prisma.sokoBotIntegration.update({
        where: { id: row.id },
        data: {
          status: "REVOKED",
          lastError: `${provider.name} authorization is no longer valid`,
        },
      });
      return "REVOKED";
    }
    throw integrationFailure(provider, error);
  }
}

export async function disconnectSokoBotIntegration(input: {
  userId: string;
  workspaceId: string;
  provider: string;
}): Promise<void> {
  const provider = requireProvider(input.provider);
  const bot = await requireBot(input.userId, input.workspaceId);
  const row = await prisma.sokoBotIntegration.findUnique({
    where: { sokoBotId_provider: { sokoBotId: bot.id, provider: provider.id } },
    select: { id: true },
  });
  if (!row) return;
  try {
    await revokeToken(requireConnectorUid(provider), {
      subject: tokenParams(bot.id, provider).subject,
    });
  } catch (error) {
    if (
      !(error instanceof NoValidTokenError) &&
      !(error instanceof UserAuthorizationRequiredError)
    ) {
      throw integrationFailure(provider, error);
    }
  }
  await prisma.sokoBotIntegration.delete({ where: { id: row.id } });
}

interface ActiveIntegration {
  id: string;
  sokoBotId: string;
  provider: SokoBotIntegrationProvider;
  cursor: Prisma.JsonValue | null;
}

export async function activeIntegrationsForBot(
  sokoBotId: string,
  kind?: SokoBotIntegrationKind,
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
      cursor: true,
    },
  });
  return rows.flatMap((row) => {
    const provider = getSokoBotIntegrationProvider(row.provider);
    if (!provider || (kind && !provider.kinds.includes(kind))) return [];
    return [{ ...row, provider }];
  });
}

async function providerFetch(
  integration: ActiveIntegration,
  kind: SokoBotIntegrationKind,
  url: URL | string,
  init?: RequestInit,
): Promise<Response> {
  const connector = requireConnectorUid(integration.provider);
  const params = tokenParams(integration.sokoBotId, integration.provider, kind);
  async function send(token: string): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");
    return fetch(url, { ...init, headers });
  }

  let response: Response;
  try {
    response = await send(await getToken(connector, params));
    if (response.status === 401) {
      deleteTokenCacheEntry(connector, params);
      response = await send(
        await getToken(connector, params, { forceRefresh: true }),
      );
    }
  } catch (error) {
    throw integrationFailure(integration.provider, error);
  }
  if (!response.ok) {
    const detail = (await response.text())
      .replaceAll(/\s+/g, " ")
      .slice(0, 500);
    throw new SokoBotIntegrationError(
      `${integration.provider.name} API returned ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return response;
}

async function providerJson(
  integration: ActiveIntegration,
  kind: SokoBotIntegrationKind,
  url: URL | string,
  init?: RequestInit,
): Promise<unknown> {
  return (await providerFetch(integration, kind, url, init)).json();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pick(value: unknown, ...keys: string[]): unknown {
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function address(value: unknown): string {
  const record = asRecord(value);
  const emailAddress = asRecord(record?.emailAddress) ?? record;
  if (!emailAddress) return str(value);
  const name = str(emailAddress.name ?? emailAddress.displayName);
  const email = str(emailAddress.address ?? emailAddress.email);
  return name && email ? `${name} <${email}>` : email || name;
}

function addressList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return asList(value).map(address).filter(Boolean);
}

function isoOrEmpty(value: unknown): string {
  const date = new Date(typeof value === "number" ? value : str(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function googleHeader(message: unknown, name: string): string {
  const headers = asList(pick(pick(message, "payload"), "headers"));
  const header = headers.find(
    (candidate) => str(pick(candidate, "name")).toLowerCase() === name,
  );
  return str(pick(header, "value"));
}

function normaliseGoogleMessage(raw: unknown): SokoBotInboxMessage {
  const labelIds = asList(pick(raw, "labelIds")).map(str);
  const internalDateValue = str(pick(raw, "internalDate"));
  const internalDate = internalDateValue
    ? Number(internalDateValue)
    : Number.NaN;
  return {
    provider: "google",
    id: str(pick(raw, "id")),
    threadId: str(pick(raw, "threadId")) || null,
    from: googleHeader(raw, "from"),
    to: addressList(googleHeader(raw, "to")),
    subject: googleHeader(raw, "subject"),
    snippet: str(pick(raw, "snippet")).slice(0, 400),
    receivedAt:
      isoOrEmpty(Number.isFinite(internalDate) ? internalDate : undefined) ||
      isoOrEmpty(googleHeader(raw, "date")),
    unread: labelIds.includes("UNREAD"),
    labels: labelIds,
  };
}

function normaliseMicrosoftMessage(raw: unknown): SokoBotInboxMessage {
  return {
    provider: "microsoft",
    id: str(pick(raw, "id")),
    threadId: str(pick(raw, "conversationId")) || null,
    from: address(pick(raw, "from", "sender")),
    to: addressList(pick(raw, "toRecipients")),
    subject: str(pick(raw, "subject")),
    snippet: str(pick(raw, "bodyPreview")).slice(0, 400),
    receivedAt: isoOrEmpty(pick(raw, "receivedDateTime")),
    unread: pick(raw, "isRead") === false,
    labels: asList(pick(raw, "categories")).map(str),
  };
}

function decodeBase64Url(value: string): string {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function gmailPartBody(part: unknown, mimeType: string): string {
  if (str(pick(part, "mimeType")) === mimeType) {
    const body = decodeBase64Url(str(pick(pick(part, "body"), "data")));
    if (body) return body;
  }
  for (const child of asList(pick(part, "parts"))) {
    const body = gmailPartBody(child, mimeType);
    if (body) return body;
  }
  return "";
}

function stripHtml(value: string): string {
  return value
    .replaceAll(/<(br|\/p|\/div|\/li)>/gi, "\n")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll(/[ \t]+/g, " ")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

async function googleMessage(
  integration: ActiveIntegration,
  messageId: string,
  format: "metadata" | "full",
): Promise<unknown> {
  const url = new URL(
    `${GOOGLE_GMAIL_BASE_URL}/messages/${encodeURIComponent(messageId)}`,
  );
  url.searchParams.set("format", format);
  if (format === "metadata") {
    for (const header of ["From", "To", "Subject", "Date"]) {
      url.searchParams.append("metadataHeaders", header);
    }
  }
  return providerJson(integration, "email", url);
}

async function fetchGoogleInboxMessages(
  integration: ActiveIntegration,
  options: {
    since?: Date;
    query?: string;
    unreadOnly?: boolean;
    limit: number;
  },
): Promise<SokoBotInboxMessage[]> {
  const url = new URL(`${GOOGLE_GMAIL_BASE_URL}/messages`);
  const query = [options.query ?? ""];
  if (options.since) {
    query.push(`after:${Math.floor(options.since.getTime() / 1_000)}`);
  }
  if (options.unreadOnly) query.push("is:unread");
  const search = query.filter(Boolean).join(" ");
  if (search) url.searchParams.set("q", search);
  url.searchParams.set("maxResults", String(options.limit));
  const data = await providerJson(integration, "email", url);
  const messages = await Promise.all(
    asList(pick(data, "messages"))
      .map((candidate) => str(pick(candidate, "id")))
      .filter(Boolean)
      .map((id) => googleMessage(integration, id, "metadata")),
  );
  return messages.map(normaliseGoogleMessage).filter((message) => message.id);
}

async function fetchMicrosoftInboxMessages(
  integration: ActiveIntegration,
  options: {
    since?: Date;
    query?: string;
    unreadOnly?: boolean;
    limit: number;
  },
): Promise<SokoBotInboxMessage[]> {
  const url = new URL(`${MICROSOFT_GRAPH_BASE_URL}/messages`);
  url.searchParams.set(
    "$select",
    "id,conversationId,from,toRecipients,subject,bodyPreview,receivedDateTime,isRead,categories",
  );
  url.searchParams.set("$top", String(options.limit));
  if (options.query) {
    url.searchParams.set(
      "$search",
      `"${options.query.replaceAll('"', '\\"')}"`,
    );
  } else {
    const filters: string[] = [];
    if (options.since) {
      filters.push(`receivedDateTime ge ${options.since.toISOString()}`);
    }
    if (options.unreadOnly) filters.push("isRead eq false");
    if (filters.length) url.searchParams.set("$filter", filters.join(" and "));
    url.searchParams.set("$orderby", "receivedDateTime desc");
  }
  const data = await providerJson(integration, "email", url);
  return asList(pick(data, "value"))
    .map(normaliseMicrosoftMessage)
    .filter((message) => {
      if (!message.id || (options.unreadOnly && !message.unread)) return false;
      return (
        !options.since ||
        !message.receivedAt ||
        new Date(message.receivedAt).getTime() >= options.since.getTime()
      );
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
  return integration.provider.id === "google"
    ? fetchGoogleInboxMessages(integration, options)
    : fetchMicrosoftInboxMessages(integration, options);
}

export async function fetchInboxMessage(
  integration: ActiveIntegration,
  messageId: string,
): Promise<SokoBotInboxMessageDetail> {
  if (integration.provider.id === "google") {
    const raw = await googleMessage(integration, messageId, "full");
    const payload = pick(raw, "payload");
    const body =
      gmailPartBody(payload, "text/plain") ||
      stripHtml(gmailPartBody(payload, "text/html")) ||
      decodeBase64Url(str(pick(pick(payload, "body"), "data")));
    return { ...normaliseGoogleMessage(raw), body: body.slice(0, 20_000) };
  }

  const url = new URL(
    `${MICROSOFT_GRAPH_BASE_URL}/messages/${encodeURIComponent(messageId)}`,
  );
  url.searchParams.set(
    "$select",
    "id,conversationId,from,toRecipients,subject,bodyPreview,body,receivedDateTime,isRead,categories",
  );
  const raw = await providerJson(integration, "email", url, {
    headers: { Prefer: 'outlook.body-content-type="text"' },
  });
  return {
    ...normaliseMicrosoftMessage(raw),
    body: str(pick(pick(raw, "body"), "content")).slice(0, 20_000),
  };
}

function googleCalendarEvent(raw: unknown): SokoBotCalendarEvent {
  const start = pick(raw, "start");
  const end = pick(raw, "end");
  return {
    provider: "google",
    id: str(pick(raw, "id")),
    title: str(pick(raw, "summary")) || "(no title)",
    startsAt: isoOrEmpty(pick(start, "dateTime", "date")),
    endsAt: isoOrEmpty(pick(end, "dateTime", "date")) || null,
    allDay: Boolean(pick(start, "date")),
    location: str(pick(raw, "location")) || null,
    attendees: addressList(pick(raw, "attendees")).slice(0, 20),
    organizer: address(pick(raw, "organizer")) || null,
    description: str(pick(raw, "description")).slice(0, 500) || null,
    link: str(pick(raw, "htmlLink")) || null,
  };
}

function microsoftDateTime(value: unknown): string {
  const dateTime = str(pick(value, "dateTime"));
  const timeZone = str(pick(value, "timeZone"));
  if (timeZone === "UTC" && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(dateTime)) {
    return isoOrEmpty(`${dateTime}Z`);
  }
  return isoOrEmpty(dateTime);
}

function microsoftCalendarEvent(raw: unknown): SokoBotCalendarEvent {
  return {
    provider: "microsoft",
    id: str(pick(raw, "id")),
    title: str(pick(raw, "subject")) || "(no title)",
    startsAt: microsoftDateTime(pick(raw, "start")),
    endsAt: microsoftDateTime(pick(raw, "end")) || null,
    allDay: Boolean(pick(raw, "isAllDay")),
    location: str(pick(pick(raw, "location"), "displayName")) || null,
    attendees: addressList(pick(raw, "attendees")).slice(0, 20),
    organizer: address(pick(raw, "organizer")) || null,
    description: str(pick(raw, "bodyPreview")).slice(0, 500) || null,
    link: str(pick(raw, "webLink")) || null,
  };
}

async function fetchGoogleCalendarEvents(
  integration: ActiveIntegration,
  options: { from: Date; to: Date; limit: number },
): Promise<SokoBotCalendarEvent[]> {
  const url = new URL(`${GOOGLE_CALENDAR_BASE_URL}/events`);
  url.searchParams.set("timeMin", options.from.toISOString());
  url.searchParams.set("timeMax", options.to.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(options.limit));
  const data = await providerJson(integration, "calendar", url);
  return asList(pick(data, "items")).map(googleCalendarEvent);
}

async function fetchMicrosoftCalendarEvents(
  integration: ActiveIntegration,
  options: { from: Date; to: Date; limit: number },
): Promise<SokoBotCalendarEvent[]> {
  const url = new URL(`${MICROSOFT_GRAPH_BASE_URL}/calendar/calendarView`);
  url.searchParams.set("startDateTime", options.from.toISOString());
  url.searchParams.set("endDateTime", options.to.toISOString());
  url.searchParams.set(
    "$select",
    "id,subject,start,end,isAllDay,location,attendees,organizer,bodyPreview,webLink",
  );
  url.searchParams.set("$top", String(options.limit));
  url.searchParams.set("$orderby", "start/dateTime");
  const data = await providerJson(integration, "calendar", url, {
    headers: { Prefer: 'outlook.timezone="UTC"' },
  });
  return asList(pick(data, "value")).map(microsoftCalendarEvent);
}

export async function fetchCalendarEvents(
  integration: ActiveIntegration,
  options: { from: Date; to: Date; limit: number },
): Promise<SokoBotCalendarEvent[]> {
  const events =
    integration.provider.id === "google"
      ? await fetchGoogleCalendarEvents(integration, options)
      : await fetchMicrosoftCalendarEvents(integration, options);
  return events
    .filter((event) => event.id && event.startsAt)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
