import type { HermesIntegrationProvider } from "@/clients/hermes-orchestrator.client";
import { getEnv } from "@/config/env";

/**
 * Composio toolkit slugs we use for Hermes integrations.
 *
 * NOTE: Composio bundles Outlook mail + calendar under a single `outlook`
 * toolkit; there is no separate `outlook_calendar` toolkit. We map both
 * `outlook` and `outlook_calendar` (orchestrator provider strings) to the
 * same `outlook` toolkit and register the resulting MCP URL under both
 * provider names on the orchestrator side.
 */
export type ComposioToolkit =
  | "gmail"
  | "googlecalendar"
  | "googlesheets"
  | "googledocs"
  | "outlook"
  | "slack"
  | "microsoft_teams"
  | "linear"
  | "jira"
  | "github"
  | "notion"
  | "hubspot"
  | "twitter"
  | "instagram"
  | "youtube"
  | "linkedin";
export type ComposioMode = "read" | "write";

const TOOLKIT_BY_PROVIDER: Record<HermesIntegrationProvider, ComposioToolkit> =
  {
    gmail: "gmail",
    google_calendar: "googlecalendar",
    google_sheets: "googlesheets",
    google_docs: "googledocs",
    outlook: "outlook",
    outlook_calendar: "outlook",
    slack: "slack",
    teams: "microsoft_teams",
    linear: "linear",
    jira: "jira",
    github: "github",
    notion: "notion",
    hubspot: "hubspot",
    twitter: "twitter",
    instagram: "instagram",
    youtube: "youtube",
    linkedin: "linkedin",
  };

export function composioToolkitForProvider(
  provider: HermesIntegrationProvider,
): ComposioToolkit {
  return TOOLKIT_BY_PROVIDER[provider];
}

/**
 * NOTE: We previously tried narrowing OAuth scopes per (toolkit, mode) via
 * `credentials.scopes` on the auth_config. Composio accepted the value, but
 * Google blocked the consent flow with *"This app is blocked"* — their
 * managed OAuth client is verified for their broad default scope set, and
 * scope-narrowing puts the request outside that verification envelope.
 *
 * So OAuth always grants Composio's full default scopes. Read-only is
 * enforced at TWO layers below OAuth:
 *
 *   1. Composio MCP server `allowed_tools` whitelist — per (toolkit, mode)
 *      so the read-mode MCP literally cannot surface SEND_* etc. to Hermes.
 *   2. Hermes orchestrator's MCP proxy — strips write-pattern tool names
 *      again on its side based on the `mode` we POST to it.
 *
 * Two independent layers, both engaged. If we ever need true OAuth-scope
 * narrowing we'd have to ship our own Google/Microsoft OAuth clients
 * (custom auth_configs) — 2-6 weeks per provider including CASA review.
 */

/**
 * Human-readable name used when (lazily) creating the auth_config and the
 * MCP server in Composio. The `-v2` suffix lets us version-bump without
 * orphaning old records. Auth configs are NOT partitioned by mode (Google
 * managed-client constraint); MCP servers ARE.
 */
const RECORD_NAME_PREFIX = "hermes";

function authConfigName(toolkit: ComposioToolkit): string {
  // v1 matches our pre-existing records (`hermes-gmail-auth-v1`) so we
  // reuse them instead of creating duplicates. These already grant
  // Composio's full default scope set, which Google has verified.
  return `${RECORD_NAME_PREFIX}-${toolkit}-auth-v1`;
}

/** Composio enforces a 30-char cap on MCP server names. */
const MAX_MCP_SERVER_NAME_LENGTH = 30;

function mcpServerName(toolkit: ComposioToolkit, mode: ComposioMode): string {
  // Use compact toolkit aliases so every combo fits within
  // `hermes-<alias>-<mode>-v5`. New toolkits with long slugs MUST get an
  // alias here — the assertion below fails fast at startup (the lazy ensure
  // path runs on first integration use) so we catch it before the
  // Composio API rejects the create with a confusing 400.
  const alias =
    toolkit === "googlecalendar"
      ? "gcal"
      : toolkit === "googlesheets"
        ? "gsheets"
        : toolkit === "googledocs"
          ? "gdocs"
          : toolkit === "microsoft_teams"
            ? "teams"
            : toolkit;
  // v5 = post-discovery that single-prefix `OUTLOOK_*` mail tools work
  // (v4 was created with a too-narrow Outlook allow_tools list).
  const name = `${RECORD_NAME_PREFIX}-${alias}-${mode}-v5`;
  if (name.length > MAX_MCP_SERVER_NAME_LENGTH) {
    throw new ComposioConfigError(
      `MCP server name "${name}" is ${name.length} chars, exceeds Composio's ${MAX_MCP_SERVER_NAME_LENGTH}-char cap. ` +
        `Add a shorter alias for toolkit "${toolkit}" in mcpServerName().`,
    );
  }
  return name;
}

export class ComposioConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposioConfigError";
  }
}

export class ComposioApiError extends Error {
  readonly httpStatus: number;
  readonly body: unknown;

  constructor(httpStatus: number, body: unknown, message?: string) {
    super(message ?? `Composio API error (${httpStatus})`);
    this.name = "ComposioApiError";
    this.httpStatus = httpStatus;
    this.body = body;
  }
}

interface ComposioFetchInit extends Omit<RequestInit, "body"> {
  jsonBody?: unknown;
  searchParams?: Record<string, string | number | undefined>;
}

async function composioFetch(
  path: string,
  init: ComposioFetchInit = {},
): Promise<Response> {
  const env = getEnv();
  if (!env.COMPOSIO_API_KEY) {
    throw new ComposioConfigError(
      "COMPOSIO_API_KEY is not configured — set it in apps/core/.env",
    );
  }

  const url = new URL(path, env.COMPOSIO_API_BASE_URL);
  if (init.searchParams) {
    for (const [key, value] of Object.entries(init.searchParams)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const headers = new Headers(init.headers);
  // Composio v3 uses `x-api-key`, NOT `Authorization: Bearer`.
  headers.set("x-api-key", env.COMPOSIO_API_KEY);
  if (init.jsonBody !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url.toString(), {
    ...init,
    headers,
    body:
      init.jsonBody !== undefined ? JSON.stringify(init.jsonBody) : undefined,
    cache: "no-store",
  });
}

async function parseResponse<T>(res: Response, context: string): Promise<T> {
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    throw new ComposioApiError(
      res.status,
      parsed,
      `${context} failed (${res.status})`,
    );
  }
  return parsed as T;
}

interface ComposioListResponse<T> {
  items?: T[];
  data?: T[];
  next_cursor?: string | null;
}

interface ComposioAuthConfig {
  id: string;
  name?: string;
  toolkit?: { slug?: string } | string;
  type?: string;
  is_composio_managed?: boolean;
  status?: string;
}

interface ComposioMcpServer {
  id: string;
  name?: string;
  auth_config_ids?: string[];
  allowed_tools?: string[];
}

/**
 * Per-process caches. Auth configs are keyed by toolkit only (Composio's
 * managed OAuth client is one per toolkit). MCP servers are keyed by
 * `${toolkit}:${mode}` so read-mode and write-mode each have their own
 * tool whitelist.
 */
const authConfigCache = new Map<ComposioToolkit, string>();
const mcpServerCache = new Map<string, string>();

function mcpCacheKey(toolkit: ComposioToolkit, mode: ComposioMode): string {
  return `${toolkit}:${mode}`;
}

/**
 * Allowed-tools whitelist passed when creating each MCP server. Partitioned
 * by mode so the read-only MCP can't even surface a SEND tool to Hermes
 * (belt) — the OAuth scope narrowing is the suspenders. The orchestrator's
 * own proxy stripping is a third independent layer.
 */
const ALLOWED_TOOLS: Record<ComposioToolkit, Record<ComposioMode, string[]>> = {
  gmail: {
    read: [
      "GMAIL_FETCH_EMAILS",
      "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
      "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      "GMAIL_SEARCH_PEOPLE",
      "GMAIL_LIST_THREADS",
    ],
    write: [
      "GMAIL_SEND_EMAIL",
      "GMAIL_FETCH_EMAILS",
      "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
      "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      "GMAIL_SEARCH_PEOPLE",
      "GMAIL_LIST_THREADS",
      "GMAIL_CREATE_EMAIL_DRAFT",
      "GMAIL_REPLY_TO_THREAD",
    ],
  },
  googlecalendar: {
    read: [
      "GOOGLECALENDAR_LIST_CALENDARS",
      "GOOGLECALENDAR_FIND_EVENT",
      "GOOGLECALENDAR_EVENTS_LIST",
      "GOOGLECALENDAR_FIND_FREE_SLOTS",
      "GOOGLECALENDAR_GET_CURRENT_DATE_TIME",
    ],
    write: [
      "GOOGLECALENDAR_LIST_CALENDARS",
      "GOOGLECALENDAR_FIND_EVENT",
      "GOOGLECALENDAR_CREATE_EVENT",
      "GOOGLECALENDAR_UPDATE_EVENT",
      "GOOGLECALENDAR_DELETE_EVENT",
      "GOOGLECALENDAR_QUICK_ADD",
      "GOOGLECALENDAR_EVENTS_LIST",
      "GOOGLECALENDAR_FIND_FREE_SLOTS",
      "GOOGLECALENDAR_GET_CURRENT_DATE_TIME",
    ],
  },
  outlook: {
    // NOTE: Composio's `?toolkit_slug=outlook` tools-listing endpoint
    // returns only a 43-item subset of the actual toolkit (~200+ tools).
    // Don't rely on that listing to decide what's valid for MCP — verify
    // by attempting MCP server creation with the slug instead.
    // The single-prefix `OUTLOOK_*` names cover mail + calendar + events
    // fully; we previously thought they didn't because the listing was
    // misleadingly incomplete.
    read: [
      "OUTLOOK_LIST_MESSAGES",
      "OUTLOOK_GET_MESSAGE",
      "OUTLOOK_SEARCH_MESSAGES",
      "OUTLOOK_LIST_EVENTS",
      "OUTLOOK_GET_EVENT",
      "OUTLOOK_LIST_CALENDARS",
      "OUTLOOK_GET_MAILBOX_SETTINGS",
    ],
    write: [
      "OUTLOOK_LIST_MESSAGES",
      "OUTLOOK_GET_MESSAGE",
      "OUTLOOK_SEARCH_MESSAGES",
      "OUTLOOK_LIST_EVENTS",
      "OUTLOOK_GET_EVENT",
      "OUTLOOK_LIST_CALENDARS",
      "OUTLOOK_GET_MAILBOX_SETTINGS",
      "OUTLOOK_SEND_EMAIL",
      "OUTLOOK_REPLY_EMAIL",
      "OUTLOOK_CREATE_DRAFT",
      "OUTLOOK_CREATE_DRAFT_REPLY",
      "OUTLOOK_SEND_DRAFT",
      "OUTLOOK_CALENDAR_CREATE_EVENT",
    ],
  },
  slack: {
    read: [
      "SLACK_LIST_ALL_CHANNELS",
      "SLACK_FETCH_CONVERSATION_HISTORY",
      "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
      "SLACK_LIST_ALL_USERS",
      "SLACK_FETCH_BOT_USER_INFORMATION",
    ],
    write: [
      "SLACK_LIST_ALL_CHANNELS",
      "SLACK_FETCH_CONVERSATION_HISTORY",
      "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
      "SLACK_LIST_ALL_USERS",
      "SLACK_FETCH_BOT_USER_INFORMATION",
      "SLACK_CHAT_POST_MESSAGE",
      "SLACK_ADD_REACTION_TO_AN_ITEM",
    ],
  },
  linear: {
    read: [
      "LINEAR_LIST_LINEAR_ISSUES",
      "LINEAR_GET_LINEAR_ISSUE",
      "LINEAR_LIST_LINEAR_PROJECTS",
      "LINEAR_LIST_LINEAR_TEAMS",
      "LINEAR_LIST_LINEAR_USERS",
      "LINEAR_LIST_LINEAR_LABELS",
      "LINEAR_LIST_LINEAR_CYCLES",
      "LINEAR_GET_CURRENT_USER",
    ],
    write: [
      "LINEAR_LIST_LINEAR_ISSUES",
      "LINEAR_GET_LINEAR_ISSUE",
      "LINEAR_LIST_LINEAR_PROJECTS",
      "LINEAR_LIST_LINEAR_TEAMS",
      "LINEAR_LIST_LINEAR_USERS",
      "LINEAR_LIST_LINEAR_LABELS",
      "LINEAR_LIST_LINEAR_CYCLES",
      "LINEAR_GET_CURRENT_USER",
      "LINEAR_CREATE_LINEAR_ISSUE",
      "LINEAR_UPDATE_ISSUE",
      "LINEAR_CREATE_LINEAR_COMMENT",
    ],
  },
  github: {
    read: [
      "GITHUB_LIST_ISSUES_ASSIGNED_TO_THE_AUTHENTICATED_USER",
      "GITHUB_LIST_ISSUE_COMMENTS",
      "GITHUB_LIST_ISSUE_COMMENTS_FOR_A_REPOSITORY",
      "GITHUB_LIST_BRANCHES",
      "GITHUB_LIST_COMMITS",
      "GITHUB_GET_REPOSITORY_CONTENT",
    ],
    write: [
      "GITHUB_LIST_ISSUES_ASSIGNED_TO_THE_AUTHENTICATED_USER",
      "GITHUB_LIST_ISSUE_COMMENTS",
      "GITHUB_LIST_ISSUE_COMMENTS_FOR_A_REPOSITORY",
      "GITHUB_LIST_BRANCHES",
      "GITHUB_LIST_COMMITS",
      "GITHUB_GET_REPOSITORY_CONTENT",
      "GITHUB_CREATE_AN_ISSUE",
      "GITHUB_CREATE_AN_ISSUE_COMMENT",
      "GITHUB_CREATE_A_PULL_REQUEST",
      "GITHUB_ADD_LABELS_TO_AN_ISSUE",
      "GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST",
    ],
  },
  notion: {
    read: [
      "NOTION_FETCH_DATA",
      "NOTION_SEARCH_NOTION_PAGE",
      "NOTION_FETCH_BLOCK_CONTENTS",
      "NOTION_FETCH_DATABASE",
      "NOTION_FETCH_ROW",
      "NOTION_QUERY_DATABASE",
      "NOTION_FETCH_COMMENTS",
      "NOTION_GET_ABOUT_ME",
    ],
    write: [
      "NOTION_FETCH_DATA",
      "NOTION_SEARCH_NOTION_PAGE",
      "NOTION_FETCH_BLOCK_CONTENTS",
      "NOTION_FETCH_DATABASE",
      "NOTION_FETCH_ROW",
      "NOTION_QUERY_DATABASE",
      "NOTION_FETCH_COMMENTS",
      "NOTION_GET_ABOUT_ME",
      "NOTION_CREATE_NOTION_PAGE",
      "NOTION_ADD_PAGE_CONTENT",
      "NOTION_UPDATE_PAGE",
      "NOTION_CREATE_COMMENT",
      "NOTION_INSERT_ROW_DATABASE",
    ],
  },
  hubspot: {
    read: [
      "HUBSPOT_HUBSPOT_LIST_CONTACTS",
      "HUBSPOT_HUBSPOT_LIST_COMPANIES",
      "HUBSPOT_HUBSPOT_LIST_DEALS",
      "HUBSPOT_HUBSPOT_GET_COMPANY",
      "HUBSPOT_HUBSPOT_GET_DEAL",
      "HUBSPOT_HUBSPOT_SEARCH_DEALS",
      "HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA",
    ],
    write: [
      "HUBSPOT_HUBSPOT_LIST_CONTACTS",
      "HUBSPOT_HUBSPOT_LIST_COMPANIES",
      "HUBSPOT_HUBSPOT_LIST_DEALS",
      "HUBSPOT_HUBSPOT_GET_COMPANY",
      "HUBSPOT_HUBSPOT_GET_DEAL",
      "HUBSPOT_HUBSPOT_SEARCH_DEALS",
      "HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA",
      "HUBSPOT_CREATE_CONTACT",
      "HUBSPOT_CREATE_COMPANY",
      "HUBSPOT_CREATE_DEAL",
      "HUBSPOT_HUBSPOT_UPDATE_CONTACT",
      "HUBSPOT_HUBSPOT_UPDATE_DEAL",
    ],
  },
  twitter: {
    read: [
      "TWITTER_POST_LOOKUP_BY_POST_ID",
      "TWITTER_POST_LOOKUP_BY_POST_IDS",
      "TWITTER_FULL_ARCHIVE_SEARCH",
      "TWITTER_FOLLOWERS_BY_USER_ID",
      "TWITTER_FOLLOWING_BY_USER_ID",
      "TWITTER_BOOKMARKS_BY_USER",
    ],
    write: [
      "TWITTER_POST_LOOKUP_BY_POST_ID",
      "TWITTER_POST_LOOKUP_BY_POST_IDS",
      "TWITTER_FULL_ARCHIVE_SEARCH",
      "TWITTER_FOLLOWERS_BY_USER_ID",
      "TWITTER_FOLLOWING_BY_USER_ID",
      "TWITTER_BOOKMARKS_BY_USER",
      "TWITTER_CREATION_OF_A_POST",
      "TWITTER_ADD_POST_TO_BOOKMARKS",
    ],
  },
  googlesheets: {
    read: [
      "GOOGLESHEETS_SEARCH_SPREADSHEETS",
      "GOOGLESHEETS_GET_SPREADSHEET_INFO",
      "GOOGLESHEETS_GET_SHEET_NAMES",
      "GOOGLESHEETS_BATCH_GET",
      "GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW",
      "GOOGLESHEETS_LIST_TABLES",
      "GOOGLESHEETS_GET_TABLE_SCHEMA",
      "GOOGLESHEETS_QUERY_TABLE",
      "GOOGLESHEETS_FIND_WORKSHEET_BY_TITLE",
    ],
    write: [
      "GOOGLESHEETS_SEARCH_SPREADSHEETS",
      "GOOGLESHEETS_GET_SPREADSHEET_INFO",
      "GOOGLESHEETS_GET_SHEET_NAMES",
      "GOOGLESHEETS_BATCH_GET",
      "GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW",
      "GOOGLESHEETS_LIST_TABLES",
      "GOOGLESHEETS_GET_TABLE_SCHEMA",
      "GOOGLESHEETS_QUERY_TABLE",
      "GOOGLESHEETS_FIND_WORKSHEET_BY_TITLE",
      "GOOGLESHEETS_CREATE_GOOGLE_SHEET1",
      "GOOGLESHEETS_ADD_SHEET",
      "GOOGLESHEETS_CREATE_SPREADSHEET_ROW",
      "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
      "GOOGLESHEETS_BATCH_UPDATE",
      "GOOGLESHEETS_CLEAR_VALUES",
      "GOOGLESHEETS_FORMAT_CELL",
      "GOOGLESHEETS_UPDATE_SHEET_PROPERTIES",
    ],
  },
  googledocs: {
    read: ["GOOGLEDOCS_GET_DOCUMENT_BY_ID", "GOOGLEDOCS_SEARCH_DOCUMENTS"],
    write: [
      "GOOGLEDOCS_GET_DOCUMENT_BY_ID",
      "GOOGLEDOCS_SEARCH_DOCUMENTS",
      "GOOGLEDOCS_CREATE_DOCUMENT",
      "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN",
      "GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN",
      "GOOGLEDOCS_UPDATE_EXISTING_DOCUMENT",
      "GOOGLEDOCS_REPLACE_ALL_TEXT",
      "GOOGLEDOCS_INSERT_TEXT_ACTION",
      "GOOGLEDOCS_INSERT_TABLE_ACTION",
      "GOOGLEDOCS_INSERT_INLINE_IMAGE",
      "GOOGLEDOCS_COPY_DOCUMENT",
    ],
  },
  microsoft_teams: {
    read: [
      "MICROSOFT_TEAMS_TEAMS_LIST",
      "MICROSOFT_TEAMS_GET_TEAM",
      "MICROSOFT_TEAMS_LIST_TEAM_MEMBERS",
      "MICROSOFT_TEAMS_TEAMS_LIST_CHANNELS",
      "MICROSOFT_TEAMS_GET_CHANNEL",
      "MICROSOFT_TEAMS_TEAMS_LIST_CHAT_MESSAGES",
      "MICROSOFT_TEAMS_CHATS_GET_ALL_CHATS",
      "MICROSOFT_TEAMS_CHATS_GET_ALL_MESSAGES",
      "MICROSOFT_TEAMS_GET_CHAT_MESSAGE",
      "MICROSOFT_TEAMS_TEAMS_GET_MESSAGE",
      "MICROSOFT_TEAMS_LIST_MESSAGE_REPLIES",
      "MICROSOFT_TEAMS_TEAMS_LIST_PEOPLE",
      "MICROSOFT_TEAMS_LIST_USERS",
    ],
    write: [
      "MICROSOFT_TEAMS_TEAMS_LIST",
      "MICROSOFT_TEAMS_GET_TEAM",
      "MICROSOFT_TEAMS_LIST_TEAM_MEMBERS",
      "MICROSOFT_TEAMS_TEAMS_LIST_CHANNELS",
      "MICROSOFT_TEAMS_GET_CHANNEL",
      "MICROSOFT_TEAMS_TEAMS_LIST_CHAT_MESSAGES",
      "MICROSOFT_TEAMS_CHATS_GET_ALL_CHATS",
      "MICROSOFT_TEAMS_CHATS_GET_ALL_MESSAGES",
      "MICROSOFT_TEAMS_GET_CHAT_MESSAGE",
      "MICROSOFT_TEAMS_TEAMS_GET_MESSAGE",
      "MICROSOFT_TEAMS_LIST_MESSAGE_REPLIES",
      "MICROSOFT_TEAMS_TEAMS_LIST_PEOPLE",
      "MICROSOFT_TEAMS_LIST_USERS",
      "MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE",
      "MICROSOFT_TEAMS_TEAMS_POST_CHAT_MESSAGE",
      "MICROSOFT_TEAMS_TEAMS_POST_MESSAGE_REPLY",
      "MICROSOFT_TEAMS_TEAMS_CREATE_CHAT",
      "MICROSOFT_TEAMS_CREATE_MEETING",
    ],
  },
  jira: {
    read: [
      "JIRA_GET_CURRENT_USER",
      "JIRA_GET_ALL_PROJECTS",
      "JIRA_GET_ALL_STATUSES",
      "JIRA_GET_ISSUE_TYPES",
      "JIRA_GET_ISSUE",
      "JIRA_SEARCH_ISSUES",
      "JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET",
      "JIRA_LIST_BOARDS",
      "JIRA_LIST_SPRINTS",
      "JIRA_LIST_ISSUE_COMMENTS",
      "JIRA_GET_COMMENT",
      "JIRA_GET_TRANSITIONS",
      "JIRA_GET_ISSUE_WATCHERS",
      "JIRA_GET_PROJECT_VERSIONS",
      "JIRA_FIND_USERS",
      "JIRA_GET_ALL_USERS",
    ],
    write: [
      "JIRA_GET_CURRENT_USER",
      "JIRA_GET_ALL_PROJECTS",
      "JIRA_GET_ALL_STATUSES",
      "JIRA_GET_ISSUE_TYPES",
      "JIRA_GET_ISSUE",
      "JIRA_SEARCH_ISSUES",
      "JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET",
      "JIRA_LIST_BOARDS",
      "JIRA_LIST_SPRINTS",
      "JIRA_LIST_ISSUE_COMMENTS",
      "JIRA_GET_COMMENT",
      "JIRA_GET_TRANSITIONS",
      "JIRA_GET_ISSUE_WATCHERS",
      "JIRA_GET_PROJECT_VERSIONS",
      "JIRA_FIND_USERS",
      "JIRA_GET_ALL_USERS",
      "JIRA_CREATE_ISSUE",
      "JIRA_EDIT_ISSUE",
      "JIRA_ADD_COMMENT",
      "JIRA_UPDATE_COMMENT",
      "JIRA_ASSIGN_ISSUE",
      "JIRA_TRANSITION_ISSUE",
      "JIRA_ADD_WATCHER_TO_ISSUE",
      "JIRA_CREATE_ISSUE_LINK",
      "JIRA_MOVE_ISSUE_TO_SPRINT",
      "JIRA_CREATE_SPRINT",
      "JIRA_CREATE_VERSION",
      "JIRA_ADD_ATTACHMENT",
    ],
  },
  instagram: {
    read: [
      "INSTAGRAM_GET_USER_INFO",
      "INSTAGRAM_GET_USER_MEDIA",
      "INSTAGRAM_GET_USER_INSIGHTS",
      "INSTAGRAM_GET_POST_COMMENTS",
      "INSTAGRAM_GET_POST_INSIGHTS",
      "INSTAGRAM_GET_POST_STATUS",
      "INSTAGRAM_GET_CONVERSATION",
      "INSTAGRAM_LIST_ALL_CONVERSATIONS",
      "INSTAGRAM_LIST_ALL_MESSAGES",
    ],
    write: [
      "INSTAGRAM_GET_USER_INFO",
      "INSTAGRAM_GET_USER_MEDIA",
      "INSTAGRAM_GET_USER_INSIGHTS",
      "INSTAGRAM_GET_POST_COMMENTS",
      "INSTAGRAM_GET_POST_INSIGHTS",
      "INSTAGRAM_GET_POST_STATUS",
      "INSTAGRAM_GET_CONVERSATION",
      "INSTAGRAM_LIST_ALL_CONVERSATIONS",
      "INSTAGRAM_LIST_ALL_MESSAGES",
      "INSTAGRAM_CREATE_POST",
      "INSTAGRAM_CREATE_MEDIA_CONTAINER",
      "INSTAGRAM_CREATE_CAROUSEL_CONTAINER",
      "INSTAGRAM_REPLY_TO_COMMENT",
      "INSTAGRAM_SEND_TEXT_MESSAGE",
      "INSTAGRAM_SEND_IMAGE",
      "INSTAGRAM_MARK_SEEN",
    ],
  },
  youtube: {
    read: [
      "YOUTUBE_SEARCH_YOU_TUBE",
      "YOUTUBE_VIDEO_DETAILS",
      "YOUTUBE_LIST_CHANNEL_VIDEOS",
      "YOUTUBE_GET_CHANNEL_ACTIVITIES",
      "YOUTUBE_GET_CHANNEL_ID_BY_HANDLE",
      "YOUTUBE_GET_CHANNEL_STATISTICS",
      "YOUTUBE_LIST_USER_PLAYLISTS",
      "YOUTUBE_LIST_USER_SUBSCRIPTIONS",
      "YOUTUBE_LIST_CAPTION_TRACK",
      "YOUTUBE_LOAD_CAPTIONS",
    ],
    write: [
      "YOUTUBE_SEARCH_YOU_TUBE",
      "YOUTUBE_VIDEO_DETAILS",
      "YOUTUBE_LIST_CHANNEL_VIDEOS",
      "YOUTUBE_GET_CHANNEL_ACTIVITIES",
      "YOUTUBE_GET_CHANNEL_ID_BY_HANDLE",
      "YOUTUBE_GET_CHANNEL_STATISTICS",
      "YOUTUBE_LIST_USER_PLAYLISTS",
      "YOUTUBE_LIST_USER_SUBSCRIPTIONS",
      "YOUTUBE_LIST_CAPTION_TRACK",
      "YOUTUBE_LOAD_CAPTIONS",
      "YOUTUBE_UPLOAD_VIDEO",
      "YOUTUBE_UPDATE_VIDEO",
      "YOUTUBE_UPDATE_THUMBNAIL",
      "YOUTUBE_SUBSCRIBE_CHANNEL",
    ],
  },
  linkedin: {
    read: ["LINKEDIN_GET_MY_INFO", "LINKEDIN_GET_COMPANY_INFO"],
    write: [
      "LINKEDIN_GET_MY_INFO",
      "LINKEDIN_GET_COMPANY_INFO",
      "LINKEDIN_CREATE_LINKED_IN_POST",
      "LINKEDIN_DELETE_LINKED_IN_POST",
    ],
  },
};

/**
 * Find-or-create the auth_config for a toolkit. Single auth_config per
 * toolkit — Composio's managed OAuth client is verified for its full
 * default scope set; narrowing via `credentials.scopes` gets blocked by
 * Google ("This app is blocked"). Mode-level enforcement happens at the
 * MCP server's `allowed_tools` instead.
 */
export async function ensureAuthConfig(
  toolkit: ComposioToolkit,
): Promise<string> {
  const cached = authConfigCache.get(toolkit);
  if (cached) return cached;

  // Look for an existing record so restarts don't create duplicates.
  const listRes = await composioFetch("/api/v3/auth_configs", {
    searchParams: { toolkit, limit: 50 },
  });
  const list = await parseResponse<ComposioListResponse<ComposioAuthConfig>>(
    listRes,
    "list auth_configs",
  );
  const items = list.items ?? list.data ?? [];
  const name = authConfigName(toolkit);
  const existing = items.find((item) => item.name === name);
  if (existing) {
    authConfigCache.set(toolkit, existing.id);
    return existing.id;
  }

  // Composio expects `name` + `type` nested under `auth_config` — top-level
  // `name` silently becomes an auto-generated `auth_config_<toolkit>_<ts>`.
  // No `credentials.scopes` here — Google rejects narrowed scopes on
  // Composio's verified managed client.
  const createRes = await composioFetch("/api/v3/auth_configs", {
    method: "POST",
    jsonBody: {
      toolkit: { slug: toolkit },
      auth_config: {
        name,
        type: "use_composio_managed_auth",
      },
    },
  });
  const created = await parseResponse<
    { auth_config?: ComposioAuthConfig } & ComposioAuthConfig
  >(createRes, "create auth_config");
  const id = created.auth_config?.id ?? created.id;
  if (!id) {
    throw new ComposioApiError(
      createRes.status,
      created,
      "create auth_config returned no id",
    );
  }
  authConfigCache.set(toolkit, id);
  return id;
}

/**
 * Find-or-create the MCP server for a (toolkit, mode) pair. One MCP server
 * per (toolkit, mode) is reused across all Sokosumi users — Composio scopes
 * the connected account per `user_id` in the MCP URL. The allowed-tools
 * whitelist is mode-specific so read-only MCPs literally don't surface SEND
 * tools to Hermes.
 */
export async function ensureMcpServer(
  toolkit: ComposioToolkit,
  mode: ComposioMode,
  authConfigId: string,
): Promise<string> {
  const key = mcpCacheKey(toolkit, mode);
  const cached = mcpServerCache.get(key);
  if (cached) return cached;

  const name = mcpServerName(toolkit, mode);
  const existingId = await findMcpServerByName(name);
  if (existingId) {
    mcpServerCache.set(key, existingId);
    return existingId;
  }

  const createRes = await composioFetch("/api/v3/mcp/servers", {
    method: "POST",
    jsonBody: {
      name,
      auth_config_ids: [authConfigId],
      allowed_tools: ALLOWED_TOOLS[toolkit][mode],
    },
  });
  const created = await parseResponse<
    { mcp_server?: ComposioMcpServer } & ComposioMcpServer
  >(createRes, "create mcp server");
  const id = created.mcp_server?.id ?? created.id;
  if (!id) {
    throw new ComposioApiError(
      createRes.status,
      created,
      "create mcp server returned no id",
    );
  }
  mcpServerCache.set(mcpCacheKey(toolkit, mode), id);
  return id;
}

/**
 * Walk every page of `/api/v3/mcp/servers` looking for a server with the
 * exact name. The list endpoint doesn't accept a name filter (unlike
 * `auth_configs?toolkit=…`), so we paginate via `next_cursor` until we
 * find the row or exhaust the list.
 *
 * Page size of 100 is the Composio max; the safety cap (50 pages = 5000
 * rows) keeps a pathological account from spinning forever.
 */
async function findMcpServerByName(name: string): Promise<string | null> {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const listRes = await composioFetch("/api/v3/mcp/servers", {
      searchParams: { limit: PAGE_SIZE, cursor },
    });
    const list = await parseResponse<ComposioListResponse<ComposioMcpServer>>(
      listRes,
      "list mcp servers",
    );
    const items = list.items ?? list.data ?? [];
    const hit = items.find((item) => item.name === name);
    if (hit?.id) return hit.id;

    const nextCursor = list.next_cursor;
    if (!nextCursor || items.length === 0) return null;
    cursor = nextCursor;
  }

  return null;
}

export interface InitiateConnectionResult {
  /** URL the user's browser should navigate to in order to complete OAuth. */
  redirectUrl: string;
  /** Composio connection identifier — pollable via `getConnection`. */
  connectionId: string;
}

/**
 * Kick off OAuth for `userId` against `toolkit`. Returns the redirect URL
 * we open in a popup, and the connection ID we can poll once the user
 * comes back from the callback page.
 */
export async function initiateConnection(input: {
  toolkit: ComposioToolkit;
  authConfigId: string;
  userId: string;
  callbackUrl: string;
}): Promise<InitiateConnectionResult> {
  const res = await composioFetch("/api/v3/connected_accounts/link", {
    method: "POST",
    jsonBody: {
      auth_config_id: input.authConfigId,
      user_id: input.userId,
      callback_url: input.callbackUrl,
    },
  });
  const body = await parseResponse<{
    redirect_url?: string;
    redirectUrl?: string;
    id?: string;
    connected_account_id?: string;
    connectedAccountId?: string;
  }>(res, "initiate connection");

  const redirectUrl = body.redirect_url ?? body.redirectUrl;
  const connectionId =
    body.id ?? body.connected_account_id ?? body.connectedAccountId;

  if (!redirectUrl || !connectionId) {
    throw new ComposioApiError(
      res.status,
      body,
      "initiate connection missing redirect_url or id",
    );
  }

  return { redirectUrl, connectionId };
}

export type ComposioConnectionStatus =
  | "INITIALIZING"
  | "INITIATED"
  | "ACTIVE"
  | "FAILED"
  | "EXPIRED"
  | "INACTIVE";

interface ComposioConnectionResponse {
  id?: string;
  status?: ComposioConnectionStatus | string;
  state?: { status?: string };
  user_id?: string;
  toolkit?: { slug?: string };
}

/** Poll the connection record after the user returns from OAuth. */
export async function getConnection(connectionId: string): Promise<{
  id: string;
  status: ComposioConnectionStatus;
}> {
  const res = await composioFetch(
    `/api/v3/connected_accounts/${encodeURIComponent(connectionId)}`,
  );
  const body = await parseResponse<ComposioConnectionResponse>(
    res,
    "get connection",
  );
  const status = (body.status ?? body.state?.status ?? "INITIATED")
    .toString()
    .toUpperCase() as ComposioConnectionStatus;
  return { id: body.id ?? connectionId, status };
}

/**
 * Build the MCP server URL the orchestrator will inject into the Hermes
 * machine. Composio scopes credentials per `user_id` so the same MCP
 * server UUID can be shared across all of our users.
 *
 * Format: https://backend.composio.dev/v3/mcp/<server-uuid>?user_id=<user-id>
 * Auth:   x-api-key: <COMPOSIO_API_KEY>   (NOT Authorization: Bearer)
 */
export function buildMcpUrl(serverUuid: string, userId: string): string {
  const env = getEnv();
  const base = env.COMPOSIO_API_BASE_URL.replace(/\/$/, "");
  return `${base}/v3/mcp/${encodeURIComponent(serverUuid)}?user_id=${encodeURIComponent(userId)}`;
}
