import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ComposioToolkitNotFoundError,
  ComposioToolNotFoundError,
} from "@composio/core";
import {
  isSokoBotEmailProvider,
  type SokoBotIntegrationProvider,
} from "@sokosumi/soko-bot";
import { getComposio } from "@/clients/composio.client";
import { adProviderForToolkit } from "@/config/ads-providers";
import { getEnv } from "@/config/env";

/** The account and its actual Composio execution identity, independent of UI. */
export interface ComposioIntegrationAccount {
  provider: SokoBotIntegrationProvider;
  composioAccountId: string;
  entityId?: string;
  sokoBotId?: string;
}

function missingEntity(): never {
  throw new SokoBotIntegrationError(
    "The connected account has no execution identity",
    "IDENTITY_MISMATCH",
  );
}

export class SokoBotIntegrationError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "IDENTITY_MISMATCH"
      | "NOT_CONFIGURED"
      | "NOT_FOUND"
      | "UNKNOWN_PROVIDER"
      | "UPSTREAM" = "UPSTREAM",
    /** The Composio call and its HTTP status, for logs that must not carry the message. */
    readonly details: { operation?: string; status?: number } = {},
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
    const status = (error as { status?: unknown } | null)?.status;
    throw new SokoBotIntegrationError(
      `Composio (${what}): ${message}`,
      isComposioMissingResource(error) ? "NOT_FOUND" : "UPSTREAM",
      {
        operation: what,
        ...(typeof status === "number" ? { status } : {}),
      },
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

export interface SokoBotIntegrationTool {
  slug: string;
  name: string;
  description: string | null;
  inputSchema: unknown;
  /** Composio marks it as only looking things up. */
  readOnly: boolean;
}

const READ_ONLY_TAG = "readOnlyHint";

/**
 * Why a bot may not use this toolkit (or tool) directly: ads go through the
 * Project's ad account, never a connection of the bot's own. Null when allowed.
 */
export function adToolkitRefusal(
  providerId: string,
  tool?: string,
): string | null {
  // A tool slug is `{TOOLKIT}_{ACTION}`, so its prefix names the toolkit.
  const provider =
    adProviderForToolkit(providerId) ??
    (tool ? adProviderForToolkit(tool.trim().split("_")[0]) : undefined);
  return provider
    ? `${provider.name} is used through the Project's ad account: start with list_ad_accounts and use the ad tools`
    : null;
}

/**
 * Read tools a query about their subject always lists first. Composio's search
 * returns a tool only when it has every word of the query, and at most `limit`
 * of a toolkit's hundreds, so "pull request merged list repository" found
 * nothing on GitHub. Slugs are checked against Composio's toolkit.
 */
const PINNED_READ_TOOLS: Record<string, { subject: RegExp; slugs: string[] }> =
  {
    github: {
      subject: /\b(pull|prs?|merged?)\b/i,
      slugs: [
        "GITHUB_LIST_PULL_REQUESTS",
        "GITHUB_FIND_PULL_REQUESTS",
        "GITHUB_GET_A_PULL_REQUEST",
      ],
    },
  };

function pinnedReadToolSlugs(providerId: string, query?: string): string[] {
  const pinned = PINNED_READ_TOOLS[providerId];
  return pinned && query && pinned.subject.test(query) ? pinned.slugs : [];
}

/** Tool descriptors of one toolkit, optionally narrowed by intent words. */
export async function listIntegrationTools(
  integration: ComposioIntegrationAccount,
  options: { query?: string; limit: number },
): Promise<SokoBotIntegrationTool[]> {
  const refusal = adToolkitRefusal(integration.provider.id);
  if (refusal) throw new SokoBotIntegrationError(refusal);
  const composio = requireComposio();
  const query = options.query?.trim() || undefined;
  const pinnedSlugs = pinnedReadToolSlugs(integration.provider.id, query);
  const [pinned, found] = await withComposio("list tools", () =>
    Promise.all([
      pinnedSlugs.length
        ? // A slug Composio renamed must not take the search down with it.
          composio.tools
            .getRawComposioTools({ tools: pinnedSlugs })
            .catch(() => [])
        : [],
      composio.tools.getRawComposioTools({
        toolkits: [integration.provider.id],
        search: query,
        limit: options.limit,
      }),
    ]),
  );
  const first = pinnedSlugs.flatMap(
    (slug) =>
      pinned.find(
        (tool) => tool.slug === slug && tool.tags?.includes(READ_ONLY_TAG),
      ) ?? [],
  );
  const tools = [
    ...first,
    ...found.filter((tool) => !first.some((pin) => pin.slug === tool.slug)),
  ].slice(0, options.limit);
  return tools.map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    description: tool.description ?? null,
    inputSchema: tool.inputParameters ?? null,
    readOnly: tool.tags?.includes(READ_ONLY_TAG) ?? false,
  }));
}

/** An empty search once read to a bot as "the account has no such tool". */
export function integrationToolSearchResult(
  tools: SokoBotIntegrationTool[],
  query?: string,
): { tools: SokoBotIntegrationTool[]; note?: string } {
  return tools.length || !query?.trim()
    ? { tools }
    : {
        tools,
        note: "No tool has every word of this query. The account may still have the tool: search again with one or two words, or without a query.",
      };
}

/** Runs one toolkit tool as the connected account; mailboxes and ad toolkits are refused. */
export async function runIntegrationTool(
  integration: ComposioIntegrationAccount,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return executeIntegrationTool(
    integration,
    integrationToolSlug(integration, tool),
    args,
  );
}

/** Runs a tool only when Composio marks it read-only, so a read can never write. */
export async function readIntegrationTool(
  integration: ComposioIntegrationAccount,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const slug = integrationToolSlug(integration, tool);
  const composio = requireComposio();
  const described = await withComposio("describe tool", () =>
    composio.tools.getRawComposioToolBySlug(slug),
  );
  if (!described.tags?.includes(READ_ONLY_TAG))
    throw new SokoBotIntegrationError(
      `${slug} is not marked read-only; a tool that changes something runs through run_integration_tool`,
    );
  return executeIntegrationTool(integration, slug, args);
}

/** The tool's slug, after refusing mailboxes, ad toolkits and other toolkits' tools. */
function integrationToolSlug(
  integration: ComposioIntegrationAccount,
  tool: string,
): string {
  const refusal = adToolkitRefusal(integration.provider.id, tool);
  if (refusal) throw new SokoBotIntegrationError(refusal);
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
  return slug;
}

/** A Composio call the model is waiting on; well under the turn budget. */
const COMPOSIO_TIMEOUT_MS = 45_000;

async function executeViaRest(
  integration: ComposioIntegrationAccount,
  slug: string,
  args: Record<string, unknown>,
): Promise<{
  successful: boolean;
  error: string | null;
  data: Record<string, unknown>;
  status: number;
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
        user_id:
          integration.entityId ??
          (integration.sokoBotId
            ? composioEntityId(integration.sokoBotId)
            : missingEntity()),
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
    throw new SokoBotIntegrationError(
      `Composio (${slug}): ${message}`,
      "UPSTREAM",
      { operation: slug, status: response.status },
    );
  }
  return {
    successful: body.successful ?? false,
    error:
      typeof body.error === "string"
        ? body.error
        : (body.error?.message ?? null),
    data: body.data ?? {},
    status: response.status,
  };
}

/**
 * Lab seam: `SOKO_BOT_INTEGRATION_FIXTURES=record` writes every Composio
 * tool response to disk; `replay` answers from disk and refuses calls that
 * were never recorded. Keys drop time-window arguments so a recording made
 * today still matches tomorrow's request.
 */
export function integrationFixtureMode(): "record" | "replay" | null {
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

export async function executeIntegrationTool(
  integration: ComposioIntegrationAccount,
  slug: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const mode = integrationFixtureMode();
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
      "UPSTREAM",
      { operation: slug, status: result.status },
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
