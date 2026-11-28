/**
 * Ticket 28 slice 1: Mainnet-only features answer 422 `mainnet_only_feature`
 * when a request names Preprod, while Mainnet requests remain unchanged
 * statement for statement.
 *
 * Covers:
 * - Mainnet unchanged across all 10 distinct mounts (no header vs `mainnet`,
 *   raw SQL statements with bound values and send order, bodies, provider calls)
 * - Every gated route driven dynamically from Core's live route tables
 *   (apiV1.routes + imageStudioAgentRouter.routes): 422 `mainnet_only_feature`,
 *   zero statements after authentication, zero provider calls, unchanged table
 *   digests before and after, on both layouts, for callers with and without
 *   Preprod access
 * - Dynamic probe routes mounted on every gated router (proves routes added
 *   later inherit the guard automatically)
 * - Image Studio reconciliation hole closed (pending fal job untouched under
 *   `preprod`, reconciles and settles normally without the header)
 * - Non-gated surfaces unchanged under `preprod` (contact CRUD & suggestions,
 *   generic Project/Task reads, signed fal webhook, cron, SEO worker claims)
 * - Key and order: Preprod API key without header (422), Mainnet key (normal),
 *   unknown header (400), contradicted key (403), unauthenticated (401)
 */
import "@hono/zod-openapi";

import crypto, { randomUUID } from "node:crypto";
import { CORE_API_ERROR_KINDS, convertCreditsToCents } from "@sokosumi/utils";
import { Hono } from "hono";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";
import { pngBytes } from "@/test/image-bytes";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

interface RecordedStatement {
  text: string;
  values: unknown[];
}

interface RecordedProviderCall {
  provider: string;
  args: unknown[];
}

const pools = vi.hoisted(() => [] as Pool[]);
const recorded = vi.hoisted(() => ({
  statements: [] as RecordedStatement[],
  providers: [] as RecordedProviderCall[],
}));
const background = vi.hoisted(() => [] as Promise<unknown>[]);

function serializeValues(values: unknown): unknown[] {
  if (!Array.isArray(values)) return [];
  return values.map((v) => {
    if (typeof v === "bigint") return `${v.toString()}n`;
    if (v instanceof Date) return v.toISOString();
    if (Buffer.isBuffer(v)) return `<Buffer:${v.length}>`;
    return v;
  });
}

vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...actual,
    waitUntil: vi.fn((work: Promise<unknown>) => {
      background.push(work);
    }),
    attachDatabasePool: (pool: Pool) => {
      pools.push(pool);
      pool.on("connect", (client: PoolClient) => {
        const orig = client.query.bind(client) as (...a: unknown[]) => unknown;
        (client as { query: unknown }).query = (...args: unknown[]) => {
          const first = args[0];
          if (typeof first === "string") {
            recorded.statements.push({
              text: first,
              values: serializeValues(args[1]),
            });
          } else if (first && typeof first === "object" && "text" in first) {
            const cfg = first as { text: string; values?: unknown[] };
            recorded.statements.push({
              text: cfg.text,
              values: serializeValues(cfg.values),
            });
          }
          return orig(...args);
        };
      });
      actual.attachDatabasePool(pool);
    },
  };
});

vi.unmock("@/lib/db/prisma");
vi.mock("@/helpers/background-email", () => ({
  sendEmailInBackground: vi.fn(),
}));
vi.mock("@/clients/stripe.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/stripe.client")>();
  return {
    ...actual,
    stripeClient: {
      ...actual.stripeClient,
      createUserCustomer: vi.fn().mockResolvedValue({}),
    },
  };
});
vi.mock("@/services/webhook.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/webhook.service")>();
  return {
    ...actual,
    webhookService: {
      ...actual.webhookService,
      callAccountCreated: vi.fn().mockResolvedValue(undefined),
      callUserWebhook: vi.fn().mockResolvedValue(undefined),
    },
  };
});
vi.mock("@/services/image-studio-drive.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/image-studio-drive.service")
    >();
  return {
    ...actual,
    publishStudioAssetToFiles: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string) => {
    recorded.providers.push({ provider: "blob.put", args: [pathname] });
    return {
      pathname,
      url: `https://blob.example.test/${pathname}`,
    };
  }),
}));
vi.mock("@/lib/image-studio/fal-catalog-refresh", () => ({
  ensureImageCatalogFresh: vi.fn(async () => {
    recorded.providers.push({
      provider: "fal.ensureImageCatalogFresh",
      args: [],
    });
  }),
  refreshImageCatalog: vi.fn(async () => {
    recorded.providers.push({ provider: "fal.refreshImageCatalog", args: [] });
    return true;
  }),
}));
vi.mock("@/lib/image-studio/fal-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/image-studio/fal-client")>();
  return {
    ...actual,
    fetchQueueStatus: vi.fn(
      async (options: { model: string; requestId: string }) => {
        recorded.providers.push({
          provider: "fal.fetchQueueStatus",
          args: [options],
        });
        return {
          kind: options.requestId.includes("talk")
            ? "in_progress"
            : "completed",
        };
      },
    ),
    fetchQueueResult: vi.fn(
      async (options: { model: string; requestId: string }) => {
        recorded.providers.push({
          provider: "fal.fetchQueueResult",
          args: [options],
        });
        return {
          kind: "media",
          media: [
            { url: `https://v3b.fal.media/files/${options.requestId}.png` },
          ],
        };
      },
    ),
    downloadMedia: vi.fn(async (url: string) => {
      recorded.providers.push({ provider: "fal.downloadMedia", args: [url] });
      return { bytes: pngBytes(1024, 1024), contentType: "image/png" };
    }),
  };
});
vi.mock("@/lib/soko-bot/exa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/soko-bot/exa")>();
  return {
    ...actual,
    searchExa: vi.fn(async (input: unknown) => {
      recorded.providers.push({ provider: "exa.searchExa", args: [input] });
      return { results: [], costUsd: 0 };
    }),
  };
});
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(async (input: unknown) => {
      recorded.providers.push({ provider: "ai.generateText", args: [input] });
      return { text: "{}", usage: { inputTokens: 0, outputTokens: 0 } };
    }),
  };
});

const BASE_DATABASE_URL = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  BASE_DATABASE_URL?.startsWith("postgres");

const ORIGIN = "https://example.com";
const HEADER = "X-Sokosumi-Network";
const EXPECTED_MESSAGE = "This feature is available on Mainnet only.";
const AGENT_SECRET = "test-agent-secret-value-0123456789abcdef01234567";
const CRON_SECRET = "test-cron-secret-value";
const CMO_CLIENT_ID = "11111111-1111-4111-8111-111111111101";
const ADMIN_USER_ID = "11111111-1111-4111-8111-111111111102";
const PLAIN_USER_ID = "11111111-1111-4111-8111-111111111120";
const PROJECT_ID = "11111111-1111-4111-8111-111111111104";
const CMO_ORG_ID = "11111111-1111-4111-8111-111111111105";
const CMO_PROJECT_ID = "11111111-1111-4111-8111-111111111107";
const CMO_BOT_ID = "11111111-1111-4111-8111-111111111108";
const AUDIT_ID = "11111111-1111-4111-8111-111111111109";
const LIST_ID = "11111111-1111-4111-8111-11111111110a";
const CONTACT_ID = "11111111-1111-4111-8111-11111111110b";
const TASK_ID = "11111111-1111-4111-8111-111111111119";
const SEO_WORKER_COWORKER_ID = "11111111-1111-4111-8111-111111111130";
const ADMIN_OAUTH_TOKEN = "soko_access_token_admin_mainnet_only_000001";
const PLAIN_OAUTH_TOKEN = "soko_access_token_plain_mainnet_only_000002";
const FIXED_DATE = new Date("2026-11-28T09:00:00.000Z");
const QUOTE = convertCreditsToCents(8);
const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const SETUP_TIMEOUT = 60_000;
const SWEEP_TIMEOUT = 60_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,}$/;

function normalizeValue(v: unknown, key = ""): unknown {
  if (typeof v === "string") {
    if (TS_RE.test(v)) return "<TS>";
    if (UUID_RE.test(v)) return v.startsWith("11111111-") ? v : "<UUID>";
    if (key === "deliveryToken" && TOKEN_RE.test(v)) return "<TOKEN>";
    if (
      v.startsWith("c") &&
      v.length >= 20 &&
      !v.includes(" ") &&
      /^[a-z0-9]+$/.test(v)
    ) {
      return "<CUID>";
    }
    if (
      (v.startsWith("{") && v.endsWith("}")) ||
      (v.startsWith("[") && v.endsWith("]"))
    ) {
      try {
        return JSON.stringify(normalizeValue(JSON.parse(v)));
      } catch {
        // fall through
      }
    }
    return v.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      (m) => (m.startsWith("11111111-") ? m : "<UUID>"),
    );
  }
  if (Array.isArray(v)) return v.map((item) => normalizeValue(item, key));
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, val]) => [k, normalizeValue(val, k)]),
    );
  }
  return v;
}

function normalizeStatement(s: RecordedStatement): string {
  return JSON.stringify({
    text: s.text,
    values: normalizeValue(s.values),
  });
}

function describeSqlStatement(sql: string): string {
  const s = sql.trim().replace(/\s+/g, " ");
  let match = s.match(/^SELECT\b.*?\bFROM\s+("[^"]+"\."[^"]+")/i);
  if (match && !/^WITH\b/i.test(s)) return `SELECT ${match[1]}`;
  match = s.match(/^INSERT\s+INTO\s+("[^"]+"\."[^"]+")/i);
  if (match) return `INSERT ${match[1]}`;
  match = s.match(/^UPDATE\s+("[^"]+"\."[^"]+")/i);
  if (match) return `UPDATE ${match[1]}`;
  match = s.match(/^DELETE\s+FROM\s+("[^"]+"\."[^"]+")/i);
  if (match) return `DELETE ${match[1]}`;
  return s.slice(0, 60);
}

async function drainBackground(): Promise<void> {
  while (background.length > 0) {
    await Promise.allSettled(background.splice(0));
  }
}

async function closePools(): Promise<void> {
  for (const pool of pools.splice(0)) {
    await pool.end().catch(() => undefined);
  }
  delete (globalThis as { coreDatabase?: unknown }).coreDatabase;
}

/** Matches every route in Core's live v1 route table that belongs to ticket 28 (slices 28-1 and 28-2). */
function classifyGatedV1Route(
  method: string,
  path: string,
): { family: string; mount: string } | null {
  if (path === "/seo" || path.startsWith("/seo/")) {
    return { family: "SEO", mount: "/v1/seo" };
  }
  if (path === "/projects/:id/seo" || path.startsWith("/projects/:id/seo/")) {
    return { family: "SEO", mount: "/v1/projects/:id/seo" };
  }
  if (path === "/image-studio" || path.startsWith("/image-studio/")) {
    return { family: "Image Studio", mount: "/v1/image-studio" };
  }
  if (
    path === "/projects/:id/image-studio" ||
    path.startsWith("/projects/:id/image-studio/")
  ) {
    return { family: "Image Studio", mount: "/v1/projects/:id/image-studio" };
  }
  if (
    path === "/image-studio-agent" ||
    path.startsWith("/image-studio-agent/")
  ) {
    return { family: "Image Studio", mount: "/v1/image-studio-agent" };
  }
  if (
    path === "/projects/:id/competitors" ||
    path.startsWith("/projects/:id/competitors/")
  ) {
    return {
      family: "Competitor checks",
      mount: "/v1/projects/:id/competitors",
    };
  }
  if (method === "POST" && path === "/contact-lists/:id/find") {
    return { family: "Contacts", mount: "POST /v1/contact-lists/:id/find" };
  }
  if (method === "POST" && path === "/contacts/:id/enrich") {
    return { family: "Contacts", mount: "POST /v1/contacts/:id/enrich" };
  }
  if (path === "/cmo" || path.startsWith("/cmo/")) {
    return { family: "CMO", mount: "/v1/cmo" };
  }
  if (method === "GET" && path === "/admin/soko-bots/cmo-spend") {
    return { family: "CMO", mount: "GET /v1/admin/soko-bots/cmo-spend" };
  }
  // Slice 28-2: billing routes
  if (path === "/checkout" || path.startsWith("/checkout/")) {
    return { family: "Billing", mount: "/v1/checkout" };
  }
  if (path === "/products" || path.startsWith("/products/")) {
    return { family: "Billing", mount: "/v1/products" };
  }
  if (path === "/coupons" || path.startsWith("/coupons/")) {
    return { family: "Billing", mount: "/v1/coupons" };
  }
  if (path === "/enterprise" || path.startsWith("/enterprise/")) {
    return { family: "Billing", mount: "/v1/enterprise" };
  }
  if (path === "/admin/invoices" || path.startsWith("/admin/invoices/")) {
    return { family: "Billing", mount: "/v1/admin/invoices" };
  }
  if (
    (method === "GET" &&
      (path === "/organizations/:id/billing-details" ||
        path === "/organizations/:id/billing-plan" ||
        path === "/organizations/:id/enterprise-contract-summary" ||
        path === "/organizations/:id/stripe-customer" ||
        path === "/organizations/:id/seat-summary" ||
        path === "/organizations/:id/credit-spend")) ||
    (method === "POST" && path === "/organizations/:id/stripe-customer") ||
    path === "/organizations/:id/subscription" ||
    path.startsWith("/organizations/:id/subscription/")
  ) {
    return { family: "Billing", mount: "/v1/organizations/:id/<billing>" };
  }
  if (
    (method === "GET" &&
      (path === "/users/:id/billing-details" ||
        path === "/users/:id/stripe-customer" ||
        path === "/users/:id/subscription")) ||
    (method === "POST" && path === "/users/:id/stripe-customer")
  ) {
    return { family: "Billing", mount: "/v1/users/:id/<billing>" };
  }
  return null;
}

function fillRouteParams(path: string): string {
  const placeholderUuid = "22222222-2222-4222-8222-222222222222";
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    if (name === "id") {
      if (path.startsWith("/seo/audits/")) return AUDIT_ID;
      if (path.startsWith("/contact-lists/")) return LIST_ID;
      if (path.startsWith("/contacts/")) return CONTACT_ID;
      return PROJECT_ID;
    }
    if (name === "projectId") return CMO_PROJECT_ID;
    if (name === "provider") return "google_search_console";
    if (name === "eveSessionId") return "eve-session-fixed";
    return placeholderUuid;
  });
}

async function loadEnvironment(
  databaseUrl: string,
  extraEnv: Record<string, string>,
) {
  await closePools();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", databaseUrl);
  vi.stubEnv("CMO_OAUTH_CLIENT_ID", CMO_CLIENT_ID);
  vi.stubEnv("IMAGE_STUDIO_AGENT_SECRET", AGENT_SECRET);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("FAL_KEY", "k");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "shared-public-store-token");
  vi.stubEnv(
    "IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN",
    "studio-private-store-token",
  );
  vi.stubEnv(
    "SEO_ANALYSIS_EXECUTOR",
    JSON.stringify({
      mode: "global",
      coworkerId: SEO_WORKER_COWORKER_ID,
      canUsePaidSearchData: true,
      canSchedule: true,
    }),
  );
  for (const [k, v] of Object.entries(extraEnv)) {
    vi.stubEnv(k, v);
  }

  const { default: prisma } = await import("@/lib/db/prisma");
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  const { createPersonalWorkspace } = await import(
    "@/helpers/personal-workspace"
  );
  const { workspaceRepository } = await import(
    "@sokosumi/database/repositories"
  );
  const { hashStoredOAuthToken, OAUTH_ACCESS_TOKEN_PREFIX } = await import(
    "@/lib/auth-oauth-token-prefixes"
  );
  const { mintAgentGrant } = await import("@/lib/image-studio/agent-grant");
  const { errorHandler } = await import("@/helpers/error-handler");
  const { default: apiV1 } = await import("@/routes/v1/index");
  const { default: imageStudioAgentRouter } = await import(
    "@/routes/image-studio-agent/index"
  );
  const { default: falWebhooksRouter } = await import(
    "@/routes/webhooks/fal/image-jobs"
  );
  const { default: syncRouter } = await import("@/routes/sync/index");
  const { resetJwksCacheForTests } = await import(
    "@/lib/image-studio/fal-webhook"
  );
  const { CMO_SOKO_BOT_VERSION_ID } = await import("@sokosumi/soko-bot");
  const { OpenAPIHonoWithAuth } = await import("@/lib/hono");
  const fixture = await import("@/test-fixtures/core-session");

  const app = new Hono();
  app.onError(errorHandler);
  app.route("/v1", apiV1);
  app.route("/image-studio-agent", imageStudioAgentRouter);
  app.route("/webhooks", falWebhooksRouter);
  app.route("/sync", syncRouter);

  // Auth-only baseline route to measure the exact statements executed by
  // `authMiddleware` alone (without workspace, scope, or handler queries).
  const authOnlyRouter = new OpenAPIHonoWithAuth();
  authOnlyRouter.get("/ping", (c) => c.json({ ok: true }));
  app.route("/__auth-only", authOnlyRouter);

  return {
    prisma,
    createNetworkScope,
    createPersonalWorkspace,
    workspaceRepository,
    hashStoredOAuthToken,
    OAUTH_ACCESS_TOKEN_PREFIX,
    mintAgentGrant,
    apiV1,
    imageStudioAgentRouter,
    resetJwksCacheForTests,
    CMO_SOKO_BOT_VERSION_ID,
    fixture,
    app,
  };
}

type Loaded = Awaited<ReturnType<typeof loadEnvironment>>;

async function seedFixtures(loaded: Loaded) {
  const { prisma, createNetworkScope, workspaceRepository } = loaded;
  const mainnetDb = createNetworkScope("mainnet").networkDb;

  await prisma.user.create({
    data: {
      id: ADMIN_USER_ID,
      name: "Admin User",
      email: "admin-28-1@example.test",
      role: "admin",
      emailVerified: true,
      termsAccepted: true,
      preprodEnabled: true,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });
  await loaded.createPersonalWorkspace(ADMIN_USER_ID);
  const adminWorkspace = await prisma.workspace.findFirstOrThrow({
    where: { userId: ADMIN_USER_ID, organizationId: null },
  });

  await prisma.user.create({
    data: {
      id: PLAIN_USER_ID,
      name: "Plain User",
      email: "plain-28-1@example.test",
      role: "user",
      emailVerified: true,
      termsAccepted: true,
      preprodEnabled: false,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });
  await loaded.createPersonalWorkspace(PLAIN_USER_ID);

  await prisma.organization.create({
    data: {
      id: CMO_ORG_ID,
      name: "Fixture CMO Org",
      slug: "fixture-cmo-org-28-1",
      createdAt: FIXED_DATE,
      members: {
        create: {
          id: "11111111-1111-4111-8111-111111111110",
          userId: ADMIN_USER_ID,
          role: "owner",
          createdAt: FIXED_DATE,
        },
      },
    },
  });
  const cmoWorkspace = await workspaceRepository.upsertOrganizationWorkspace({
    organizationId: CMO_ORG_ID,
    tx: prisma,
  });

  await prisma.project.create({
    data: {
      id: PROJECT_ID,
      workspaceId: adminWorkspace.id,
      name: "Fixture Project",
      websiteUrl: "https://acme.example.com",
      contextMd: "# Fixture Context",
      contextMdUrl: "https://blob.example.test/context.md",
      contextMdUpdatedAt: FIXED_DATE,
      contextMdModel: "claude-sonnet",
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });
  await prisma.project.create({
    data: {
      id: CMO_PROJECT_ID,
      workspaceId: cmoWorkspace.id,
      name: "CMO.xyz · Fixture",
      websiteUrl: "https://cmo.example.com",
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });
  await prisma.sokoBot.create({
    data: {
      id: CMO_BOT_ID,
      workspaceId: cmoWorkspace.id,
      projectId: CMO_PROJECT_ID,
      userId: null,
      versionId: loaded.CMO_SOKO_BOT_VERSION_ID,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });
  await prisma.seoAudit.create({
    data: {
      id: AUDIT_ID,
      workspaceId: adminWorkspace.id,
      name: "Fixture Audit",
      createdById: ADMIN_USER_ID,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });
  await prisma.contactList.create({
    data: {
      id: LIST_ID,
      workspaceId: adminWorkspace.id,
      name: "Fixture List",
      nameKey: "fixture list",
      color: "blue",
      description: "Founders at Acme",
      createdByUserId: ADMIN_USER_ID,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });
  await prisma.contact.create({
    data: {
      id: CONTACT_ID,
      workspaceId: adminWorkspace.id,
      name: "Jane Doe",
      kind: "PERSON",
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });
  await prisma.task.create({
    data: {
      id: TASK_ID,
      ownerId: ADMIN_USER_ID,
      workspaceId: adminWorkspace.id,
      name: "Fixture Task",
      status: "READY",
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });

  // Fund Mainnet wallet for Studio settlement + Contact find/enrich
  const grant = await mainnetDb.transaction.create({
    data: {
      userId: ADMIN_USER_ID,
      amount: convertCreditsToCents(200),
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });
  await mainnetDb.creditBucket.create({
    data: {
      userId: ADMIN_USER_ID,
      amount: grant.amount,
      sourceTransactionId: grant.id,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });

  // First-party OAuth tokens for admin (with Preprod access) and plain user (without)
  const scopes = ["sokosumi:api"];
  await prisma.oauthClient.create({
    data: {
      id: "11111111-1111-4111-8111-111111111112",
      clientId: CMO_CLIENT_ID,
      scopes,
      skipConsent: true,
    },
  });
  for (const [uid, token, cid, tid] of [
    [
      ADMIN_USER_ID,
      ADMIN_OAUTH_TOKEN,
      "11111111-1111-4111-8111-111111111113",
      "11111111-1111-4111-8111-111111111114",
    ],
    [
      PLAIN_USER_ID,
      PLAIN_OAUTH_TOKEN,
      "11111111-1111-4111-8111-111111111123",
      "11111111-1111-4111-8111-111111111124",
    ],
  ] as const) {
    await prisma.oauthConsent.create({
      data: { id: cid, clientId: CMO_CLIENT_ID, userId: uid, scopes },
    });
    await prisma.oauthAccessToken.create({
      data: {
        id: tid,
        clientId: CMO_CLIENT_ID,
        userId: uid,
        scopes,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        token: loaded.hashStoredOAuthToken(
          token,
          loaded.OAUTH_ACCESS_TOKEN_PREFIX,
        ),
      },
    });
  }

  // Global SEO worker coworker key
  const { generateCoworkerApiKeyToken, hashApiKey } = await import(
    "@/lib/coworker-api-key"
  );
  const vendor = await prisma.vendor.create({
    data: { name: "SEO Worker Vendor", slug: "seo-worker-vendor-28-1" },
  });
  await prisma.coworker.create({
    data: {
      id: SEO_WORKER_COWORKER_ID,
      name: "Global SEO Worker",
      slug: "global-seo-worker-28-1",
      vendorId: vendor.id,
    },
  });
  const seoWorkerToken = generateCoworkerApiKeyToken();
  await prisma.coworkerApiKey.create({
    data: {
      coworkerId: SEO_WORKER_COWORKER_ID,
      keyHash: await hashApiKey(seoWorkerToken),
      keyStart: seoWorkerToken.slice(0, 12),
    },
  });

  const agentToken = loaded.mintAgentGrant(
    {
      userId: ADMIN_USER_ID,
      projectId: PROJECT_ID,
      audience: "agent",
      ttlSeconds: 3600,
    },
    AGENT_SECRET,
  );

  return {
    adminWorkspaceId: adminWorkspace.id,
    cmoWorkspaceId: cmoWorkspace.id,
    agentToken,
    seoWorkerToken,
  };
}

/**
 * Computes a deterministic PostgreSQL digest over all feature tables and
 * Network credit tables so any hidden write fails the comparison.
 */
async function featureTablesDigest(
  loaded: Loaded,
): Promise<Record<string, string>> {
  const names = testSchemaNames();
  const shared = names.DATABASE_SCHEMA_SHARED;
  const mainnet = names.DATABASE_SCHEMA_MAINNET;
  const preprod = names.DATABASE_SCHEMA_PREPROD;

  const targets: { key: string; schema: string; table: string }[] = [
    { key: "shared.seo_audit", schema: shared, table: "seo_audit" },
    {
      key: "shared.project_seo_scope",
      schema: shared,
      table: "project_seo_scope",
    },
    {
      key: "shared.project_image_job",
      schema: shared,
      table: "project_image_job",
    },
    {
      key: "shared.project_image_asset",
      schema: shared,
      table: "project_image_asset",
    },
    {
      key: "shared.project_image_session",
      schema: shared,
      table: "project_image_session",
    },
    {
      key: "shared.project_studio_product_catalog",
      schema: shared,
      table: "project_studio_product_catalog",
    },
    {
      key: "shared.tracked_competitor",
      schema: shared,
      table: "tracked_competitor",
    },
    { key: "shared.contact", schema: shared, table: "contact" },
    { key: "shared.contact_list", schema: shared, table: "contact_list" },
    {
      key: "shared.contact_suggestion",
      schema: shared,
      table: "contact_suggestion",
    },
    {
      key: "shared.contact_people_search",
      schema: shared,
      table: "contact_people_search",
    },
    { key: "shared.soko_bot", schema: shared, table: "soko_bot" },
    { key: "mainnet.Transaction", schema: mainnet, table: "Transaction" },
    { key: "mainnet.credit_bucket", schema: mainnet, table: "credit_bucket" },
    {
      key: "mainnet.credit_consumption",
      schema: mainnet,
      table: "credit_consumption",
    },
  ];
  if (onSplitLayout) {
    targets.push(
      { key: "preprod.Transaction", schema: preprod, table: "Transaction" },
      { key: "preprod.credit_bucket", schema: preprod, table: "credit_bucket" },
      {
        key: "preprod.credit_consumption",
        schema: preprod,
        table: "credit_consumption",
      },
    );
  }

  const digests: Record<string, string> = {};
  for (const target of targets) {
    const rows = await loaded.prisma.$queryRawUnsafe<{ digest: string }[]>(
      `SELECT COALESCE(md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text)), 'empty') AS digest FROM "${target.schema}"."${target.table}" t`,
    );
    digests[target.key] = rows[0]?.digest ?? "empty";
  }
  return digests;
}

// ============================================================================
// Suite 1: Mainnet unchanged across all 10 mounts (today's layout)
// ============================================================================
describe.runIf(enabled && !onSplitLayout)(
  "Mainnet unchanged across all 10 mounts (no header vs mainnet header)",
  () => {
    async function runMainnetOperations(networkHeader?: string) {
      const copy = await copyPostgresTestDatabase(
        BASE_DATABASE_URL!,
        "mainnet_only_test",
      );
      try {
        const loaded = await loadEnvironment(copy.url, {
          NETWORK_PREPROD_ENABLED: "false",
        });
        const seeded = await seedFixtures(loaded);

        await loaded.prisma.projectImageJob.create({
          data: {
            id: "11111111-1111-4111-8111-11111111110c",
            projectId: PROJECT_ID,
            workspaceId: seeded.adminWorkspaceId,
            requestedByUserId: ADMIN_USER_ID,
            kind: "GENERATE",
            model: "fal-ai/gemini-3.1-flash-image-preview",
            prompt: "a cup",
            settings: {},
            referenceAssetIds: [],
            idempotencyKey: "fixed-key-state",
            status: "QUEUED",
            falRequestId: "fal-req-state",
            submitAttempts: 1,
            submittedAt: FIXED_DATE,
            chargedCents: QUOTE,
            createdAt: FIXED_DATE,
            updatedAt: FIXED_DATE,
          },
        });

        const authHeaders = {
          authorization: `Bearer ${ADMIN_OAUTH_TOKEN}`,
          ...(networkHeader ? { [HEADER]: networkHeader } : {}),
        };
        const agentHeaders = {
          authorization: `Bearer ${seeded.agentToken}`,
          ...(networkHeader ? { [HEADER]: networkHeader } : {}),
        };

        const out: Record<
          string,
          {
            status: number;
            body: unknown;
            statements: RecordedStatement[];
            providers: RecordedProviderCall[];
          }
        > = {};

        async function run(
          name: string,
          method: string,
          path: string,
          headers: Record<string, string>,
          body?: unknown,
        ) {
          recorded.statements.length = 0;
          recorded.providers.length = 0;
          const res = await loaded.app.request(`${ORIGIN}${path}`, {
            method,
            headers: {
              origin: ORIGIN,
              ...(body !== undefined
                ? { "content-type": "application/json" }
                : {}),
              ...headers,
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          });
          const text = await res.text();
          await drainBackground();
          out[name] = {
            status: res.status,
            body: text ? JSON.parse(text) : null,
            statements: [...recorded.statements],
            providers: [...recorded.providers],
          };
        }

        // 1. SEO: /v1/seo
        await run("seo_audits_read", "GET", "/v1/seo/audits", authHeaders);
        await run(
          "seo_audits_write",
          "PATCH",
          `/v1/seo/audits/${AUDIT_ID}`,
          authHeaders,
          { archived: true },
        );
        // 2. SEO: /v1/projects/:id/seo
        await run(
          "project_seo_read",
          "GET",
          `/v1/projects/${PROJECT_ID}/seo`,
          authHeaders,
        );
        await run(
          "project_seo_write",
          "PUT",
          `/v1/projects/${PROJECT_ID}/seo/brand-terms`,
          authHeaders,
          { terms: ["Acme"] },
        );
        // 3. Image Studio: /v1/image-studio
        await run(
          "image_studio_catalog_read",
          "GET",
          "/v1/image-studio/catalog",
          authHeaders,
        );
        await run(
          "image_studio_state_read",
          "GET",
          "/v1/image-studio/state",
          authHeaders,
        );
        // 4. Image Studio: /v1/projects/:id/image-studio
        await loaded.prisma.projectImageJob.create({
          data: {
            id: "11111111-1111-4111-8111-11111111110d",
            projectId: PROJECT_ID,
            workspaceId: seeded.adminWorkspaceId,
            requestedByUserId: ADMIN_USER_ID,
            kind: "GENERATE",
            model: "fal-ai/gemini-3.1-flash-image-preview",
            prompt: "a bowl",
            settings: {},
            referenceAssetIds: [],
            idempotencyKey: "fixed-key-proj",
            status: "QUEUED",
            falRequestId: "fal-req-proj",
            submitAttempts: 1,
            submittedAt: FIXED_DATE,
            chargedCents: QUOTE,
            createdAt: FIXED_DATE,
            updatedAt: FIXED_DATE,
          },
        });
        await run(
          "project_image_studio_read",
          "GET",
          `/v1/projects/${PROJECT_ID}/image-studio`,
          authHeaders,
        );
        await run(
          "project_image_studio_talking_videos_read",
          "GET",
          `/v1/projects/${PROJECT_ID}/image-studio/talking-videos`,
          authHeaders,
        );
        await run(
          "project_image_studio_write",
          "PUT",
          `/v1/projects/${PROJECT_ID}/image-studio/products`,
          authHeaders,
          { products: [], revision: 0 },
        );
        // 5. Image Studio Agent: /v1/image-studio-agent
        await run(
          "v1_image_studio_agent_read",
          "GET",
          "/v1/image-studio-agent/products",
          agentHeaders,
        );
        await run(
          "v1_image_studio_agent_write",
          "POST",
          "/v1/image-studio-agent/sessions",
          agentHeaders,
          {
            eveSessionId: "eve-session-fixed",
            title: "Fixed Session",
            clientIntentId: "intent-fixed-1",
          },
        );
        // 6. Image Studio Agent root: /image-studio-agent
        await run(
          "root_image_studio_agent_read",
          "GET",
          "/image-studio-agent/options",
          agentHeaders,
        );
        await run(
          "root_image_studio_agent_write",
          "POST",
          "/image-studio-agent/sessions/eve-session-fixed/authorize",
          agentHeaders,
        );
        // 7. Competitor checks: /v1/projects/:id/competitors
        await run(
          "project_competitors_read",
          "GET",
          `/v1/projects/${PROJECT_ID}/competitors`,
          authHeaders,
        );
        await run(
          "project_competitors_write",
          "POST",
          `/v1/projects/${PROJECT_ID}/competitors`,
          authHeaders,
          {
            name: "RivalCo",
            websiteUrl: "https://rival.example.com",
          },
        );
        // 8. Contacts: Find & Enrich
        await run(
          "contact_list_find_write",
          "POST",
          `/v1/contact-lists/${LIST_ID}/find`,
          authHeaders,
          {
            size: 1,
            brief: "Jane Doe at Acme",
          },
        );
        await run(
          "contact_enrich_write",
          "POST",
          `/v1/contacts/${CONTACT_ID}/enrich`,
          authHeaders,
        );
        // 9. CMO: /v1/cmo
        await run("cmo_read", "GET", "/v1/cmo/cusos", authHeaders);
        await run(
          "cmo_write",
          "PUT",
          `/v1/cmo/projects/${CMO_PROJECT_ID}/time-zone`,
          authHeaders,
          { timeZone: "UTC" },
        );
        // 10. CMO Admin Spend
        await run(
          "admin_cmo_spend_read",
          "GET",
          "/v1/admin/soko-bots/cmo-spend",
          authHeaders,
        );

        await closePools();
        return out;
      } finally {
        await closePools();
        await copy.drop();
      }
    }

    it("produces identical status, body, SQL statements with bound values, and provider calls with no header and with mainnet header", {
      timeout: 120_000,
    }, async () => {
      // Guard against whole-second Postgres timestamps escaping normalization (m3).
      expect(normalizeValue("2026-11-28 09:46:50")).toBe("<TS>");
      expect(normalizeValue("2026-11-28T09:46:50Z")).toBe("<TS>");
      expect(normalizeValue("2026-11-28 09:46:50.123")).toBe("<TS>");

      const noHeader = await runMainnetOperations();
      const mainnetHeader = await runMainnetOperations("mainnet");

      // Expected statuses, provider calls, and SQL statement counts pinned from
      // the origin/main (56b37da22) baseline recording on today's layout.
      const expectedStatusAndProviders: Record<
        string,
        {
          status: number;
          statementCount: number;
          providers: string[];
          concurrentReads?: boolean;
        }
      > = {
        seo_audits_read: {
          status: 200,
          statementCount: 15,
          providers: [],
          concurrentReads: true,
        },
        seo_audits_write: { status: 204, statementCount: 31, providers: [] },
        project_seo_read: {
          status: 200,
          statementCount: 37,
          providers: [],
          concurrentReads: true,
        },
        project_seo_write: {
          status: 200,
          statementCount: 62,
          providers: [],
          concurrentReads: true,
        },
        image_studio_catalog_read: {
          status: 200,
          statementCount: 5,
          providers: ["fal.ensureImageCatalogFresh"],
        },
        image_studio_state_read: {
          status: 200,
          statementCount: 43,
          providers: [
            "fal.fetchQueueStatus",
            "fal.fetchQueueResult",
            "fal.downloadMedia",
            "blob.put",
          ],
          concurrentReads: true,
        },
        project_image_studio_read: {
          status: 200,
          statementCount: 49,
          providers: [
            "fal.fetchQueueStatus",
            "fal.fetchQueueResult",
            "fal.downloadMedia",
            "blob.put",
          ],
          concurrentReads: true,
        },
        project_image_studio_talking_videos_read: {
          status: 200,
          statementCount: 15,
          providers: [],
        },
        project_image_studio_write: {
          status: 200,
          statementCount: 13,
          providers: [],
        },
        v1_image_studio_agent_read: {
          status: 200,
          statementCount: 3,
          providers: [],
        },
        v1_image_studio_agent_write: {
          status: 201,
          statementCount: 9,
          providers: [],
        },
        root_image_studio_agent_read: {
          status: 200,
          statementCount: 2,
          providers: ["fal.ensureImageCatalogFresh"],
        },
        root_image_studio_agent_write: {
          status: 200,
          statementCount: 6,
          providers: [],
        },
        project_competitors_read: {
          status: 200,
          statementCount: 15,
          providers: [],
        },
        project_competitors_write: {
          status: 200,
          statementCount: 22,
          providers: [],
        },
        contact_list_find_write: {
          status: 200,
          statementCount: 16,
          providers: ["exa.searchExa"],
        },
        contact_enrich_write: {
          status: 200,
          statementCount: 14,
          providers: ["exa.searchExa"],
        },
        cmo_read: { status: 200, statementCount: 9, providers: [] },
        cmo_write: { status: 200, statementCount: 13, providers: [] },
        admin_cmo_spend_read: {
          status: 200,
          statementCount: 17,
          providers: [],
        },
      };

      // Exact SQL statement lists recorded on origin/main (56b37da22) across
      // all 5 families and every guard placement so any DB read added by the
      // guard on a Mainnet request fails immediately.
      const originMainStatementsByFamily: Record<string, readonly string[]> = {
        // SEO (OpenAPIHonoWithAuth mainnetOnly: true)
        seo_audits_write: [
          'SELECT "public"."oauthAccessToken"',
          'SELECT "public"."oauthRefreshToken"',
          'SELECT "public"."user"',
          'SELECT "public"."oauthClient"',
          'SELECT "public"."workspace"',
          'SELECT "public"."oauthAccessToken"',
          'SELECT "public"."oauthRefreshToken"',
          'SELECT "public"."user"',
          'SELECT "public"."oauthClient"',
          'SELECT "public"."workspace"',
          "BEGIN",
          'SELECT "public"."member"',
          "SELECT pg_advisory_xact_lock( hashtextextended($1::TEXT, 0) ",
          'SELECT "public"."user"',
          'SELECT "public"."workspace"',
          'SELECT "public"."workspace"',
          'SELECT "public"."seo_audit"',
          'UPDATE "public"."seo_audit"',
          'SELECT "public"."project_seo_analysis"',
          'SELECT "public"."seo_audit_chat_turn"',
          'SELECT "public"."task_schedule"',
          'UPDATE "public"."seo_audit"',
          'SELECT "public"."seo_audit"',
          'SELECT "public"."project_seo_analysis"',
          'SELECT "public"."project_seo_action_task"',
          'SELECT "public"."task"',
          'SELECT "public"."task"',
          'SELECT "public"."task"',
          'UPDATE "public"."task"',
          'UPDATE "public"."seo_audit"',
          "COMMIT",
        ],
        // Image Studio (/v1/image-studio, /v1/image-studio-agent, root /image-studio-agent)
        image_studio_catalog_read: [
          'SELECT "public"."oauthAccessToken"',
          'SELECT "public"."oauthRefreshToken"',
          'SELECT "public"."user"',
          'SELECT "public"."oauthClient"',
          'SELECT "public"."workspace"',
        ],
        v1_image_studio_agent_read: [
          'SELECT "public"."project"',
          'SELECT "public"."workspace"',
          'SELECT "public"."project_studio_product_catalog"',
        ],
        root_image_studio_agent_read: [
          'SELECT "public"."project"',
          'SELECT "public"."workspace"',
        ],
        // Competitor checks (OpenAPIHonoWithAuth mainnetOnly path rule)
        project_competitors_read: [
          'SELECT "public"."oauthAccessToken"',
          'SELECT "public"."oauthRefreshToken"',
          'SELECT "public"."user"',
          'SELECT "public"."oauthClient"',
          'SELECT "public"."workspace"',
          'SELECT "public"."project"',
          'SELECT "public"."workspace"',
          'SELECT "public"."soko_bot"',
          'SELECT "public"."tracked_competitor"',
          'SELECT "public"."competitor_signal"',
          'SELECT "public"."competitor_signal"',
          'SELECT "public"."competitor_check"',
          'SELECT "public"."project_social_connection"',
          'SELECT "public"."project"',
          'SELECT "public"."competitor_feed"',
        ],
        // Contacts Find & Enrich (OpenAPIHonoWithAuth mainnetOnly method rule)
        contact_list_find_write: [
          'SELECT "public"."oauthAccessToken"',
          'SELECT "public"."oauthRefreshToken"',
          'SELECT "public"."user"',
          'SELECT "public"."oauthClient"',
          'SELECT "public"."workspace"',
          'SELECT "public"."workspace"',
          'SELECT "public"."contact_list"',
          'SELECT "public"."workspace"',
          "WITH bucket_avail AS ( SELECT (cb.amount - COALESCE(SUM(cc.a",
          'SELECT "public"."contact_suggestion"',
          'SELECT "public"."contact_channel"',
          "BEGIN",
          "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
          'INSERT "public"."contact_people_search"',
          'SELECT "public"."contact_suggestion"',
          "COMMIT",
        ],
        contact_enrich_write: [
          'SELECT "public"."oauthAccessToken"',
          'SELECT "public"."oauthRefreshToken"',
          'SELECT "public"."user"',
          'SELECT "public"."oauthClient"',
          'SELECT "public"."workspace"',
          'SELECT "public"."workspace"',
          'SELECT "public"."contact"',
          'SELECT "public"."contact_channel"',
          'SELECT "public"."workspace"',
          "WITH bucket_avail AS ( SELECT (cb.amount - COALESCE(SUM(cc.a",
          "BEGIN",
          "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
          'INSERT "public"."contact_people_search"',
          "COMMIT",
        ],
        // CMO (/v1/cmo and /v1/admin/soko-bots/cmo-spend)
        cmo_read: [
          'SELECT "public"."oauthAccessToken"',
          'SELECT "public"."oauthRefreshToken"',
          'SELECT "public"."user"',
          'SELECT "public"."oauthClient"',
          'SELECT "public"."soko_bot"',
          'SELECT "public"."project"',
          'SELECT "public"."workspace"',
          'SELECT "public"."marketing_strategy"',
          'SELECT "public"."organization"',
        ],
        admin_cmo_spend_read: [
          'SELECT "public"."oauthAccessToken"',
          'SELECT "public"."oauthRefreshToken"',
          'SELECT "public"."user"',
          'SELECT "public"."oauthClient"',
          "SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now",
          'SELECT "public"."eval_lane"',
          'SELECT "public"."soko_bot"',
          'SELECT "public"."project"',
          'WITH RECURSIVE lab_up AS ( SELECT t."id" AS "start", t."pare',
          'SELECT "public"."user"',
          'SELECT "public"."soko_bot_turn"',
          'SELECT "public"."soko_bot_turn"',
          'SELECT "public"."soko_bot_tool_call"',
          'SELECT "public"."project_image_job"',
          'SELECT "public"."soko_bot_usage"',
          'SELECT "public"."soko_bot_tool_call"',
          'SELECT "public"."soko_bot_turn"',
        ],
      };

      for (const [name, expected] of Object.entries(
        expectedStatusAndProviders,
      )) {
        const a = noHeader[name]!;
        const b = mainnetHeader[name]!;
        expect([name, a.status]).toEqual([name, expected.status]);
        expect([name, b.status]).toEqual([name, expected.status]);
        expect([name, a.statements.length]).toEqual([
          name,
          expected.statementCount,
        ]);
        expect([name, b.statements.length]).toEqual([
          name,
          expected.statementCount,
        ]);
        const pinnedStatements = originMainStatementsByFamily[name];
        if (pinnedStatements) {
          expect([
            name,
            a.statements.map((s) => describeSqlStatement(s.text)),
          ]).toEqual([name, [...pinnedStatements]]);
          expect([
            name,
            b.statements.map((s) => describeSqlStatement(s.text)),
          ]).toEqual([name, [...pinnedStatements]]);
        }
        expect([name, a.providers.map((p) => p.provider)]).toEqual([
          name,
          expected.providers,
        ]);
        expect([name, normalizeValue(b.providers)]).toEqual([
          name,
          normalizeValue(a.providers),
        ]);
        expect([name, normalizeValue(b.body)]).toEqual([
          name,
          normalizeValue(a.body),
        ]);
        const aStmts = a.statements.map(normalizeStatement);
        const bStmts = b.statements.map(normalizeStatement);
        if (expected.concurrentReads) {
          // Handlers using Promise.all can interleave parallel queries on the pool.
          expect([name, [...bStmts].sort()]).toEqual([
            name,
            [...aStmts].sort(),
          ]);
        } else {
          expect([name, bStmts]).toEqual([name, aStmts]);
        }
      }
    });
  },
);

// ============================================================================
// Suite 2: Every gated route (route-table driven), Studio hole, non-gated
//          controls, and key/order rules (runs on BOTH layouts)
// ============================================================================
describe.skipIf(!enabled)(
  `Mainnet-only feature guard on ${onSplitLayout ? "split layout (Preprod on)" : "today's layout (Preprod off)"}`,
  () => {
    let copy: Awaited<ReturnType<typeof copyPostgresTestDatabase>>;
    let loaded: Loaded;
    let seeded: Awaited<ReturnType<typeof seedFixtures>>;

    beforeAll(async () => {
      copy = await copyPostgresTestDatabase(
        BASE_DATABASE_URL!,
        "mainnet_only_test",
      );
      loaded = await loadEnvironment(copy.url, {
        NETWORK_PREPROD_ENABLED: onSplitLayout ? "true" : "false",
      });
      seeded = await seedFixtures(loaded);
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      await closePools();
      if (copy) await copy.drop();
    }, SETUP_TIMEOUT);

    it("refuses every gated route in Core's live route tables with 422 mainnet_only_feature, zero statements after auth, zero provider calls, and unchanged table digests", {
      timeout: SWEEP_TIMEOUT,
    }, async () => {
      // Collect every concrete gated route from apiV1.routes and imageStudioAgentRouter.routes
      const seen = new Set<string>();
      const gatedRoutes: {
        family: string;
        mount: string;
        method: string;
        fullPath: string;
        authKind: "oauth" | "agentGrant";
      }[] = [];

      for (const route of loaded.apiV1.routes) {
        if (route.method === "ALL" || route.path.includes("*")) continue;
        const match = classifyGatedV1Route(route.method, route.path);
        if (!match) continue;
        const key = `${route.method} /v1${route.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        gatedRoutes.push({
          ...match,
          method: route.method,
          fullPath: `/v1${fillRouteParams(route.path)}`,
          authKind:
            match.mount === "/v1/image-studio-agent" ? "agentGrant" : "oauth",
        });
      }

      for (const route of loaded.imageStudioAgentRouter.routes) {
        if (route.method === "ALL" || route.path.includes("*")) continue;
        const key = `${route.method} /image-studio-agent${route.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        gatedRoutes.push({
          family: "Image Studio",
          mount: "/image-studio-agent",
          method: route.method,
          fullPath: `/image-studio-agent${fillRouteParams(route.path)}`,
          authKind: "agentGrant",
        });
      }

      // Guard against a filter bug silently dropping any of the 10 mounts.
      const countsByMount = new Map<string, number>();
      for (const route of gatedRoutes) {
        countsByMount.set(
          route.mount,
          (countsByMount.get(route.mount) ?? 0) + 1,
        );
      }
      expect(countsByMount.get("/v1/seo")).toBeGreaterThanOrEqual(8);
      expect(countsByMount.get("/v1/projects/:id/seo")).toBeGreaterThanOrEqual(
        15,
      );
      expect(countsByMount.get("/v1/image-studio")).toBeGreaterThanOrEqual(3);
      expect(
        countsByMount.get("/v1/projects/:id/image-studio"),
      ).toBeGreaterThanOrEqual(25);
      expect(
        countsByMount.get("/v1/image-studio-agent"),
      ).toBeGreaterThanOrEqual(5);
      expect(countsByMount.get("/image-studio-agent")).toBeGreaterThanOrEqual(
        6,
      );
      expect(
        countsByMount.get("/v1/projects/:id/competitors"),
      ).toBeGreaterThanOrEqual(8);
      expect(countsByMount.get("POST /v1/contact-lists/:id/find")).toBe(1);
      expect(countsByMount.get("POST /v1/contacts/:id/enrich")).toBe(1);
      expect(countsByMount.get("/v1/cmo")).toBeGreaterThanOrEqual(50);
      expect(countsByMount.get("GET /v1/admin/soko-bots/cmo-spend")).toBe(1);
      // Slice 28-2 billing mount floors
      expect(countsByMount.get("/v1/checkout")).toBeGreaterThanOrEqual(2);
      expect(countsByMount.get("/v1/products")).toBeGreaterThanOrEqual(3);
      expect(countsByMount.get("/v1/coupons")).toBeGreaterThanOrEqual(2);
      expect(countsByMount.get("/v1/enterprise")).toBeGreaterThanOrEqual(7);
      expect(countsByMount.get("/v1/admin/invoices")).toBeGreaterThanOrEqual(5);
      expect(
        countsByMount.get("/v1/organizations/:id/<billing>"),
      ).toBeGreaterThanOrEqual(11);
      expect(
        countsByMount.get("/v1/users/:id/<billing>"),
      ).toBeGreaterThanOrEqual(4);

      // Measure exact auth-only statement count for OAuth bearer (no workspace/scope/handler queries).
      recorded.statements.length = 0;
      const authPing = await loaded.app.request(`${ORIGIN}/__auth-only/ping`, {
        headers: {
          origin: ORIGIN,
          authorization: `Bearer ${ADMIN_OAUTH_TOKEN}`,
        },
      });
      expect(authPing.status).toBe(200);
      const oauthAuthStatements = [...recorded.statements].map((s) => s.text);

      // Measure exact auth-only statement count for agent grant (requireProjectAccessForUser).
      recorded.statements.length = 0;
      const { requireAgentGrant } = await import(
        "@/routes/image-studio-agent/authorize"
      );
      await requireAgentGrant(
        new Request(`${ORIGIN}/v1/image-studio-agent/products`, {
          headers: { authorization: `Bearer ${seeded.agentToken}` },
        }),
      );
      const grantAuthStatements = [...recorded.statements].map((s) => s.text);

      const digestBefore = await featureTablesDigest(loaded);

      // Sweep every single gated route as a caller WITH Preprod access (admin),
      // and sweep representative routes per mount as a caller WITHOUT Preprod access.
      const callers: {
        label: string;
        oauthToken: string;
        fullSweep: boolean;
      }[] = [
        {
          label: "with Preprod access",
          oauthToken: ADMIN_OAUTH_TOKEN,
          fullSweep: true,
        },
        {
          label: "without Preprod access",
          oauthToken: PLAIN_OAUTH_TOKEN,
          fullSweep: false,
        },
      ];

      for (const caller of callers) {
        const seenMount = new Set<string>();
        for (const route of gatedRoutes) {
          if (!caller.fullSweep) {
            if (route.authKind !== "oauth") continue;
            if (seenMount.has(route.mount)) continue;
            seenMount.add(route.mount);
          }

          recorded.statements.length = 0;
          recorded.providers.length = 0;

          const response = await loaded.app.request(
            `${ORIGIN}${route.fullPath}`,
            {
              method: route.method,
              headers: {
                origin: ORIGIN,
                authorization: `Bearer ${
                  route.authKind === "agentGrant"
                    ? seeded.agentToken
                    : caller.oauthToken
                }`,
                [HEADER]: "preprod",
                ...(route.method !== "GET" && route.method !== "DELETE"
                  ? { "content-type": "application/json" }
                  : {}),
              },
              ...(route.method !== "GET" && route.method !== "DELETE"
                ? { body: "{}" }
                : {}),
            },
          );
          await drainBackground();

          const body = (await response.json()) as {
            kind?: string;
            message?: string;
          };
          expect([
            caller.label,
            route.method,
            route.fullPath,
            response.status,
            body.kind,
            body.message,
          ]).toEqual([
            caller.label,
            route.method,
            route.fullPath,
            422,
            CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
            EXPECTED_MESSAGE,
          ]);
          expect([route.method, route.fullPath, recorded.providers]).toEqual([
            route.method,
            route.fullPath,
            [],
          ]);
          const expectedAuthStmts =
            route.authKind === "agentGrant"
              ? grantAuthStatements
              : oauthAuthStatements;
          expect([
            caller.label,
            route.method,
            route.fullPath,
            recorded.statements.map((s) => s.text).sort(),
          ]).toEqual([
            caller.label,
            route.method,
            route.fullPath,
            [...expectedAuthStmts].sort(),
          ]);
        }
      }

      const digestAfter = await featureTablesDigest(loaded);
      expect(digestAfter).toEqual(digestBefore);
    });

    it("automatically gates a route added later under any gated /v1 router", async () => {
      let probeHit = 0;
      const probe = (c: { json: (v: unknown) => Response }) => {
        probeHit += 1;
        return c.json({ ok: true });
      };

      const { default: seoRouter } = await import("@/routes/v1/seo/index");
      const { default: imageStudioRouter } = await import(
        "@/routes/v1/image-studio/index"
      );
      const { default: cmoRouter } = await import("@/routes/v1/cmo/index");
      const { default: projectsRouter } = await import(
        "@/routes/v1/projects/index"
      );
      const { default: v1AgentRouter } = await import(
        "@/routes/v1/image-studio-agent/index"
      );

      seoRouter.get("/__probe-28-1", probe);
      imageStudioRouter.get("/__probe-28-1", probe);
      cmoRouter.get("/__probe-28-1", probe);
      projectsRouter.get("/:id/seo/__probe-28-1", probe);
      projectsRouter.get("/:id/image-studio/__probe-28-1", probe);
      projectsRouter.get("/:id/competitors/__probe-28-1", probe);
      v1AgentRouter.get("/__probe-28-1", probe);

      // Re-mount into a test app so Hono's router compiles the added probes.
      const { errorHandler } = await import("@/helpers/error-handler");
      const { requestNetworkMiddleware } = await import(
        "@/middleware/network-scope"
      );
      const probeApp = new Hono();
      probeApp.onError(errorHandler);
      probeApp.use("/v1/*", requestNetworkMiddleware);
      probeApp.route("/v1/seo", seoRouter);
      probeApp.route("/v1/image-studio", imageStudioRouter);
      probeApp.route("/v1/cmo", cmoRouter);
      probeApp.route("/v1/projects", projectsRouter);
      probeApp.route("/v1/image-studio-agent", v1AgentRouter);

      const probes: [string, string][] = [
        ["/v1/seo/__probe-28-1", ADMIN_OAUTH_TOKEN],
        ["/v1/image-studio/__probe-28-1", ADMIN_OAUTH_TOKEN],
        ["/v1/cmo/__probe-28-1", ADMIN_OAUTH_TOKEN],
        [`/v1/projects/${PROJECT_ID}/seo/__probe-28-1`, ADMIN_OAUTH_TOKEN],
        [
          `/v1/projects/${PROJECT_ID}/image-studio/__probe-28-1`,
          ADMIN_OAUTH_TOKEN,
        ],
        [
          `/v1/projects/${PROJECT_ID}/competitors/__probe-28-1`,
          ADMIN_OAUTH_TOKEN,
        ],
        ["/v1/image-studio-agent/__probe-28-1", seeded.agentToken],
      ];

      for (const [path, token] of probes) {
        const res = await probeApp.request(`${ORIGIN}${path}`, {
          headers: {
            origin: ORIGIN,
            authorization: `Bearer ${token}`,
            [HEADER]: "preprod",
          },
        });
        expect([path, res.status]).toEqual([path, 422]);
        expect(await res.json()).toMatchObject({
          kind: CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
          message: EXPECTED_MESSAGE,
        });
      }
      expect(probeHit).toBe(0);
    });

    it("keeps root /image-studio-agent identical to origin/main (56b37da22) for every non-preprod request while refusing valid preprod on served handlers", async () => {
      const sharedSchema = testSchemaNames().DATABASE_SCHEMA_SHARED;
      const grantAuthStatements = [
        `SELECT "${sharedSchema}"."project"`,
        `SELECT "${sharedSchema}"."workspace"`,
      ];
      const grantHeaders = { authorization: `Bearer ${seeded.agentToken}` };

      async function callRoot(
        method: string,
        path: string,
        headers: Record<string, string>,
      ) {
        recorded.statements.length = 0;
        const res = await loaded.app.request(`${ORIGIN}${path}`, {
          method,
          headers: { origin: ORIGIN, ...headers },
        });
        const bodyText = await res.text();
        await drainBackground();
        return {
          status: res.status,
          bodyText,
          statements: recorded.statements.map((s) =>
            describeSqlStatement(s.text),
          ),
        };
      }

      // Recorded on origin/main (56b37da22): OPTIONS on all 6 served paths
      // answer 404 "404 Not Found" with 0 SQL statements regardless of grant
      // or X-Sokosumi-Network header.
      const servedPaths = [
        "/image-studio-agent/access",
        "/image-studio-agent/sessions/eve-session-fixed/authorize",
        "/image-studio-agent/options",
        "/image-studio-agent/versions",
        "/image-studio-agent/generations",
        "/image-studio-agent/generations/22222222-2222-4222-8222-222222222222",
      ];
      const optionsHeaderVariants: Record<string, string>[] = [
        {},
        grantHeaders,
        { [HEADER]: "testnet" },
        { ...grantHeaders, [HEADER]: "preprod" },
      ];
      for (const path of servedPaths) {
        for (const headers of optionsHeaderVariants) {
          expect([path, await callRoot("OPTIONS", path, headers)]).toEqual([
            path,
            { status: 404, bodyText: "404 Not Found", statements: [] },
          ]);
        }
      }

      // Recorded on origin/main (56b37da22): unserved paths and wrong methods
      // answer 404 "404 Not Found" with 0 SQL statements (never running the 2
      // grant access statements, even with a valid grant or invalid header).
      const unservedAndWrongMethod: [string, string, Record<string, string>][] =
        [
          ["GET", "/image-studio-agent/__nope", {}],
          ["GET", "/image-studio-agent/__nope", grantHeaders],
          [
            "GET",
            "/image-studio-agent/__nope",
            { ...grantHeaders, [HEADER]: "testnet" },
          ],
          [
            "GET",
            "/image-studio-agent/__nope",
            { ...grantHeaders, [HEADER]: "Mainnet" },
          ],
          [
            "GET",
            "/image-studio-agent/__nope",
            { ...grantHeaders, [HEADER]: "preprod" },
          ],
          ["GET", "/image-studio-agent/access", {}],
          ["GET", "/image-studio-agent/access", grantHeaders],
          ["DELETE", "/image-studio-agent/options", grantHeaders],
          ["POST", "/image-studio-agent/versions", grantHeaders],
          ["GET", "/image-studio-agent/generations", grantHeaders],
        ];
      for (const [method, path, headers] of unservedAndWrongMethod) {
        expect([method, path, await callRoot(method, path, headers)]).toEqual([
          method,
          path,
          { status: 404, bodyText: "404 Not Found", statements: [] },
        ]);
      }

      // Recorded on origin/main (56b37da22): invalid header values ("testnet",
      // "Mainnet") are ignored on served handlers (200 with grant, 401 without
      // grant, 404 for unknown job).
      const optionsTestnet = await callRoot(
        "GET",
        "/image-studio-agent/options",
        { ...grantHeaders, [HEADER]: "testnet" },
      );
      expect(optionsTestnet.status).toBe(200);
      expect(JSON.parse(optionsTestnet.bodyText)).toMatchObject({ ok: true });
      expect(optionsTestnet.statements).toEqual(grantAuthStatements);

      const optionsMainnetCase = await callRoot(
        "GET",
        "/image-studio-agent/options",
        { ...grantHeaders, [HEADER]: "Mainnet" },
      );
      expect(optionsMainnetCase.status).toBe(200);
      expect(JSON.parse(optionsMainnetCase.bodyText)).toMatchObject({
        ok: true,
      });
      expect(optionsMainnetCase.statements).toEqual(grantAuthStatements);

      expect(
        await callRoot("GET", "/image-studio-agent/options", {
          [HEADER]: "testnet",
        }),
      ).toEqual({
        status: 401,
        bodyText: '{"ok":false,"error":"unauthorized"}',
        statements: [],
      });

      expect(
        await callRoot("POST", "/image-studio-agent/access", {
          ...grantHeaders,
          [HEADER]: "testnet",
        }),
      ).toEqual({
        status: 200,
        bodyText: '{"ok":true}',
        statements: grantAuthStatements,
      });

      const missingJobMainnetCase = await callRoot(
        "GET",
        "/image-studio-agent/generations/22222222-2222-4222-8222-222222222222",
        { ...grantHeaders, [HEADER]: "Mainnet" },
      );
      expect(missingJobMainnetCase.status).toBe(404);
      expect(missingJobMainnetCase.bodyText).toBe(
        '{"ok":false,"error":"not_found"}',
      );

      // Valid "preprod" header on the 6 served handlers: 401 before guard when
      // unauthenticated, 422 mainnet_only_feature after the 2 auth statements
      // when authorized.
      const servedHandlers: [string, string][] = [
        ["POST", "/image-studio-agent/access"],
        ["POST", "/image-studio-agent/sessions/eve-session-fixed/authorize"],
        ["GET", "/image-studio-agent/options"],
        ["GET", "/image-studio-agent/versions"],
        ["POST", "/image-studio-agent/generations"],
        [
          "GET",
          "/image-studio-agent/generations/22222222-2222-4222-8222-222222222222",
        ],
      ];
      for (const [method, path] of servedHandlers) {
        expect([
          method,
          path,
          await callRoot(method, path, { [HEADER]: "preprod" }),
        ]).toEqual([
          method,
          path,
          {
            status: 401,
            bodyText: '{"ok":false,"error":"unauthorized"}',
            statements: [],
          },
        ]);

        const preprodAuth = await callRoot(method, path, {
          ...grantHeaders,
          [HEADER]: "preprod",
        });
        expect([method, path, preprodAuth.status]).toEqual([method, path, 422]);
        expect(JSON.parse(preprodAuth.bodyText)).toMatchObject({
          kind: CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
          message: EXPECTED_MESSAGE,
        });
        expect([method, path, preprodAuth.statements]).toEqual([
          method,
          path,
          grantAuthStatements,
        ]);
      }

      // Secret unset: recorded on origin/main — OPTIONS, unserved paths, and
      // wrong methods stay 404 "404 Not Found" (0 statements), while served
      // handlers answer 503 {"ok":false,"error":"not_configured"} (0 statements)
      // even when X-Sokosumi-Network is invalid or "preprod".
      const envModule = await import("@/config/env");
      const realEnv = envModule.getEnv();
      const envSpy = vi.spyOn(envModule, "getEnv").mockReturnValue({
        ...realEnv,
        IMAGE_STUDIO_AGENT_SECRET: undefined,
      });
      try {
        for (const [method, path] of [
          ["OPTIONS", "/image-studio-agent/options"],
          ["GET", "/image-studio-agent/__nope"],
          ["GET", "/image-studio-agent/access"],
        ] as const) {
          expect([method, path, await callRoot(method, path, {})]).toEqual([
            method,
            path,
            { status: 404, bodyText: "404 Not Found", statements: [] },
          ]);
        }
        const secretUnsetHeaders: Record<string, string>[] = [
          {},
          { [HEADER]: "testnet" },
          { [HEADER]: "preprod" },
        ];
        for (const headers of secretUnsetHeaders) {
          expect(
            await callRoot("GET", "/image-studio-agent/options", headers),
          ).toEqual({
            status: 503,
            bodyText: '{"ok":false,"error":"not_configured"}',
            statements: [],
          });
          expect(
            await callRoot("POST", "/image-studio-agent/access", headers),
          ).toEqual({
            status: 503,
            bodyText: '{"ok":false,"error":"not_configured"}',
            statements: [],
          });
        }
      } finally {
        envSpy.mockRestore();
      }
    });

    it("closes the Image Studio reconciliation hole under preprod and still reconciles without the header", async () => {
      const mainnetDb = loaded.createNetworkScope("mainnet").networkDb;
      const imageJob = await loaded.prisma.projectImageJob.create({
        data: {
          projectId: PROJECT_ID,
          workspaceId: seeded.adminWorkspaceId,
          requestedByUserId: ADMIN_USER_ID,
          kind: "GENERATE",
          model: "fal-ai/gemini-3.1-flash-image-preview",
          prompt: "a blue mug",
          settings: {},
          referenceAssetIds: [],
          idempotencyKey: `studio-hole-img-${randomUUID()}`,
          status: "QUEUED",
          falRequestId: `fal-hole-img-${randomUUID()}`,
          submitAttempts: 1,
          submittedAt: FIXED_DATE,
          chargedCents: QUOTE,
        },
      });
      const talkingJob = await loaded.prisma.projectImageJob.create({
        data: {
          projectId: PROJECT_ID,
          workspaceId: seeded.adminWorkspaceId,
          requestedByUserId: ADMIN_USER_ID,
          kind: "TALKING_VIDEO",
          model: "talking-video",
          prompt: "hello world",
          settings: {},
          referenceAssetIds: [],
          idempotencyKey: `studio-hole-talk-${randomUUID()}`,
          status: "QUEUED",
          falRequestId: `fal-hole-talk-${randomUUID()}`,
          submitAttempts: 1,
          submittedAt: FIXED_DATE,
          chargedCents: QUOTE,
        },
      });

      const txCountBefore = await mainnetDb.transaction.count({
        where: { userId: ADMIN_USER_ID, amount: { lt: 0n } },
      });

      recorded.providers.length = 0;
      const studioGets: [string, string][] = [
        ["/v1/image-studio/state", ADMIN_OAUTH_TOKEN],
        [`/v1/projects/${PROJECT_ID}/image-studio`, ADMIN_OAUTH_TOKEN],
        [
          `/v1/projects/${PROJECT_ID}/image-studio/talking-videos`,
          ADMIN_OAUTH_TOKEN,
        ],
        ["/image-studio-agent/versions", seeded.agentToken],
        [`/image-studio-agent/generations/${imageJob.id}`, seeded.agentToken],
      ];

      for (const [path, token] of studioGets) {
        const res = await loaded.app.request(`${ORIGIN}${path}`, {
          headers: {
            origin: ORIGIN,
            authorization: `Bearer ${token}`,
            [HEADER]: "preprod",
          },
        });
        expect([path, res.status]).toEqual([path, 422]);
        expect(await res.json()).toMatchObject({
          kind: CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
        });
      }

      // Provider, jobs, assets, and Mainnet transactions are completely untouched.
      expect(recorded.providers).toEqual([]);
      const [imgAfterPreprod, talkAfterPreprod] = await Promise.all([
        loaded.prisma.projectImageJob.findUniqueOrThrow({
          where: { id: imageJob.id },
        }),
        loaded.prisma.projectImageJob.findUniqueOrThrow({
          where: { id: talkingJob.id },
        }),
      ]);
      expect(imgAfterPreprod.status).toBe("QUEUED");
      expect(imgAfterPreprod.settledAt).toBeNull();
      expect(imgAfterPreprod.transactionId).toBeNull();
      expect(talkAfterPreprod.status).toBe("QUEUED");
      expect(talkAfterPreprod.settledAt).toBeNull();
      expect(talkAfterPreprod.transactionId).toBeNull();
      expect(
        await mainnetDb.transaction.count({
          where: { userId: ADMIN_USER_ID, amount: { lt: 0n } },
        }),
      ).toBe(txCountBefore);

      // Same GET without the header reconciles and settles on Mainnet as on origin/main.
      const mainnetState = await loaded.app.request(
        `${ORIGIN}/v1/image-studio/state`,
        {
          headers: {
            origin: ORIGIN,
            authorization: `Bearer ${ADMIN_OAUTH_TOKEN}`,
          },
        },
      );
      await drainBackground();
      expect(mainnetState.status).toBe(200);
      expect(
        recorded.providers.some((p) => p.provider === "fal.fetchQueueStatus"),
      ).toBe(true);
      const imgAfterMainnet =
        await loaded.prisma.projectImageJob.findUniqueOrThrow({
          where: { id: imageJob.id },
        });
      expect(imgAfterMainnet.status).toBe("SUCCEEDED");
      expect(imgAfterMainnet.settledAt).not.toBeNull();
      expect(imgAfterMainnet.transactionId).not.toBeNull();
      expect(
        await mainnetDb.transaction.count({
          where: { userId: ADMIN_USER_ID, amount: { lt: 0n } },
        }),
      ).toBeGreaterThan(txCountBefore);
    });

    it("leaves contact CRUD, list suggestions, generic Project/Task reads, signed fal webhook, cron, and SEO worker claims ungated under preprod", async () => {
      const authPreprod = {
        origin: ORIGIN,
        authorization: `Bearer ${ADMIN_OAUTH_TOKEN}`,
        [HEADER]: "preprod",
      };

      // Contact CRUD & list suggestions
      const listContacts = await loaded.app.request(`${ORIGIN}/v1/contacts`, {
        headers: authPreprod,
      });
      expect(listContacts.status).toBe(200);

      const getContact = await loaded.app.request(
        `${ORIGIN}/v1/contacts/${CONTACT_ID}`,
        { headers: authPreprod },
      );
      expect(getContact.status).toBe(200);

      const createContact = await loaded.app.request(`${ORIGIN}/v1/contacts`, {
        method: "POST",
        headers: { ...authPreprod, "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada Lovelace", kind: "PERSON" }),
      });
      expect(createContact.status).toBe(201);
      const createdContact = (
        (await createContact.json()) as {
          data: { contact: { id: string; version: number } };
        }
      ).data.contact;

      const patchContact = await loaded.app.request(
        `${ORIGIN}/v1/contacts/${createdContact.id}`,
        {
          method: "PATCH",
          headers: { ...authPreprod, "content-type": "application/json" },
          body: JSON.stringify({
            version: createdContact.version,
            role: "Mathematician",
          }),
        },
      );
      expect(patchContact.status).toBe(200);

      const listSuggestions = await loaded.app.request(
        `${ORIGIN}/v1/contact-lists/${LIST_ID}/suggestions`,
        { headers: authPreprod },
      );
      expect(listSuggestions.status).toBe(200);

      // Generic Project read (shared context-md on both layouts; full Project & Task on today's layout)
      const projectContext = await loaded.app.request(
        `${ORIGIN}/v1/projects/${PROJECT_ID}/context-md`,
        { headers: authPreprod },
      );
      expect(projectContext.status).toBe(200);

      if (!onSplitLayout) {
        const projectGet = await loaded.app.request(
          `${ORIGIN}/v1/projects/${PROJECT_ID}`,
          { headers: authPreprod },
        );
        expect(projectGet.status).toBe(200);

        const taskGet = await loaded.app.request(
          `${ORIGIN}/v1/tasks/${TASK_ID}`,
          { headers: authPreprod },
        );
        expect(taskGet.status).toBe(200);
      }

      // Signed fal webhook delivery with X-Sokosumi-Network: preprod settles on Mainnet; bad sig stays 401
      const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
      loaded.resetJwksCacheForTests();
      const realFetch = globalThis.fetch;
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input, init) => {
          if (String(input) !== JWKS_URL) return realFetch(input, init);
          const { x } = publicKey.export({ format: "jwk" });
          return Response.json({ keys: [{ kty: "OKP", crv: "Ed25519", x }] });
        });
      try {
        const webhookJob = await loaded.prisma.projectImageJob.create({
          data: {
            projectId: PROJECT_ID,
            workspaceId: seeded.adminWorkspaceId,
            requestedByUserId: ADMIN_USER_ID,
            kind: "GENERATE",
            model: "fal-ai/gemini-3.1-flash-image-preview",
            prompt: "fal callback cup",
            settings: {},
            referenceAssetIds: [],
            idempotencyKey: `fal-cb-${randomUUID()}`,
            status: "QUEUED",
            falRequestId: `fal-cb-req-${randomUUID()}`,
            submitAttempts: 1,
            submittedAt: FIXED_DATE,
            chargedCents: QUOTE,
          },
        });
        const deliver = async (sign: boolean) => {
          const payload = {
            request_id: webhookJob.falRequestId!,
            status: "OK",
            payload: {
              images: [
                {
                  url: "https://v3b.fal.media/files/cb.png",
                  width: 1024,
                  height: 1024,
                },
              ],
            },
          };
          const raw = JSON.stringify(payload);
          const falUserId = "fal-user";
          const timestamp = String(Math.floor(Date.now() / 1000));
          const hash = crypto.createHash("sha256").update(raw).digest("hex");
          const message = [payload.request_id, falUserId, timestamp, hash].join(
            "\n",
          );
          const signature = sign
            ? crypto
                .sign(null, Buffer.from(message), privateKey)
                .toString("hex")
            : "00".repeat(64);
          return await loaded.app.request(`${ORIGIN}/webhooks/fal/image-jobs`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              [HEADER]: "preprod",
              "x-fal-webhook-request-id": payload.request_id,
              "x-fal-webhook-user-id": falUserId,
              "x-fal-webhook-timestamp": timestamp,
              "x-fal-webhook-signature": signature,
            },
            body: raw,
          });
        };

        expectCoreLog("warn", "Rejected a fal webhook delivery");
        const badSig = await deliver(false);
        expect(badSig.status).toBe(401);

        const goodSig = await deliver(true);
        await drainBackground();
        expect(goodSig.status).toBe(200);
        expect(await goodSig.json()).toEqual({ ok: true });
        const settled = await loaded.prisma.projectImageJob.findUniqueOrThrow({
          where: { id: webhookJob.id },
        });
        expect(settled.status).toBe("SUCCEEDED");
        expect(settled.transactionId).not.toBeNull();
        if (onSplitLayout) {
          const preprodDb = loaded.createNetworkScope("preprod").networkDb;
          expect(
            await preprodDb.transaction.count({
              where: { userId: ADMIN_USER_ID },
            }),
          ).toBe(0);
        }
      } finally {
        fetchSpy.mockRestore();
      }

      // Cron route with X-Sokosumi-Network: preprod
      const cronRes = await loaded.app.request(`${ORIGIN}/sync/image-catalog`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${CRON_SECRET}`,
          [HEADER]: "preprod",
        },
      });
      await drainBackground();
      expect(cronRes.status).toBe(200);

      // SEO worker claim route with X-Sokosumi-Network: preprod
      const claimRes = await loaded.app.request(
        `${ORIGIN}/v1/seo-impact/claims`,
        {
          method: "POST",
          headers: {
            origin: ORIGIN,
            authorization: `Bearer ${seeded.seoWorkerToken}`,
            [HEADER]: "preprod",
          },
        },
      );
      expect(claimRes.status).toBe(200);
    });

    it("never answers 422 mainnet_only_feature for any non-gated /v1 handler in the runtime route table under preprod", {
      timeout: SWEEP_TIMEOUT,
    }, async () => {
      const seen = new Set<string>();
      const ungatedRoutes: {
        method: string;
        path: string;
        fullPath: string;
      }[] = [];

      for (const route of loaded.apiV1.routes) {
        if (
          route.method === "ALL" ||
          route.path.includes("*") ||
          route.path === "/openapi.json"
        ) {
          continue;
        }
        if (classifyGatedV1Route(route.method, route.path) !== null) continue;
        const key = `${route.method} /v1${route.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const placeholderPath = route.path.replace(
          /:([A-Za-z0-9_]+)/g,
          "22222222-2222-4222-8222-222222222222",
        );
        ungatedRoutes.push({
          method: route.method,
          path: route.path,
          fullPath: `/v1${placeholderPath}`,
        });
      }

      // Guard against a filter bug silently dropping ungated routes, and
      // explicitly verify Seat entitlement/assignment and generic org routes
      // stay open on Preprod.
      expect(ungatedRoutes.length).toBeGreaterThanOrEqual(700);
      for (const [method, path] of [
        ["GET", "/contacts/:id"],
        ["GET", "/organizations/:id"],
        ["GET", "/organizations/:id/members/me/seat"],
        ["PUT", "/organizations/:id/members/:memberId/seat"],
        ["DELETE", "/organizations/:id/members/:memberId/seat"],
        ["PUT", "/admin/organizations/:slug/members/:memberId/seat"],
        ["DELETE", "/admin/organizations/:slug/members/:memberId/seat"],
      ] as const) {
        expect(
          ungatedRoutes.some((r) => r.method === method && r.path === path),
        ).toBe(true);
      }

      // Sending an unknown X-Organization-Slug stops non-gated OpenAPIHonoWithAuth
      // routes at organizationContextMiddleware (after auth and AFTER any
      // mainnetOnly guard), preventing unrelated handlers from calling external
      // providers or mutating seeded rows while still triggering any erroneous
      // mainnetOnly gate immediately after authMiddleware.
      const gatedViolations: string[] = [];
      for (const route of ungatedRoutes) {
        const res = await loaded.app.request(`${ORIGIN}${route.fullPath}`, {
          method: route.method,
          headers: {
            origin: ORIGIN,
            authorization: `Bearer ${PLAIN_OAUTH_TOKEN}`,
            "x-organization-slug": "nonexistent-org-slug-28-1",
            [HEADER]: "preprod",
            ...(route.method !== "GET" && route.method !== "DELETE"
              ? { "content-type": "application/json" }
              : {}),
          },
          ...(route.method !== "GET" && route.method !== "DELETE"
            ? { body: "{}" }
            : {}),
        });
        await drainBackground();
        if (res.status === 422) {
          const text = await res.text();
          let kind: string | undefined;
          try {
            kind = (JSON.parse(text) as { kind?: string }).kind;
          } catch {
            // non-JSON 422
          }
          if (kind === CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE) {
            gatedViolations.push(`${route.method} /v1${route.path}`);
          }
        }
      }
      expect(gatedViolations).toEqual([]);
    });

    it("keeps 400 network_unknown for invalid headers on /v1 mounts and 401 for unauthenticated requests across all mounts", async () => {
      const v1Paths: [string, string][] = [
        ["GET", "/v1/seo/audits"],
        ["GET", `/v1/projects/${PROJECT_ID}/seo`],
        ["GET", "/v1/image-studio/state"],
        ["GET", `/v1/projects/${PROJECT_ID}/image-studio`],
        ["GET", "/v1/image-studio-agent/products"],
        ["GET", `/v1/projects/${PROJECT_ID}/competitors`],
        ["POST", `/v1/contact-lists/${LIST_ID}/find`],
        ["POST", `/v1/contacts/${CONTACT_ID}/enrich`],
        ["GET", "/v1/cmo/cusos"],
        ["GET", "/v1/admin/soko-bots/cmo-spend"],
      ];

      for (const [method, path] of v1Paths) {
        const unknown = await loaded.app.request(`${ORIGIN}${path}`, {
          method,
          headers: { origin: ORIGIN, [HEADER]: "testnet" },
        });
        expect([method, path, unknown.status]).toEqual([method, path, 400]);
        expect(await unknown.json()).toMatchObject({
          kind: CORE_API_ERROR_KINDS.NETWORK_UNKNOWN,
        });
      }

      for (const [method, path] of [
        ...v1Paths,
        ["GET", "/image-studio-agent/options"] as [string, string],
      ]) {
        const unauth = await loaded.app.request(`${ORIGIN}${path}`, {
          method,
          headers: { origin: ORIGIN, [HEADER]: "preprod" },
        });
        expect([method, path, unauth.status]).toEqual([method, path, 401]);
      }
    });

    it.runIf(onSplitLayout)(
      "handles Preprod API keys (422 without header), Mainnet API keys (200), and contradicted keys (403 api_key_network_mismatch)",
      async () => {
        const preprodKey = await loaded.fixture.createApiKey(
          ADMIN_USER_ID,
          "soko_preprod_",
        );
        const mainnetKey = await loaded.fixture.createApiKey(
          ADMIN_USER_ID,
          "soko_mainnet_",
        );

        // Measure auth-only statement count for an API key.
        recorded.statements.length = 0;
        const ping = await loaded.app.request(`${ORIGIN}/__auth-only/ping`, {
          headers: {
            origin: ORIGIN,
            authorization: `Bearer ${preprodKey}`,
          },
        });
        expect(ping.status).toBe(200);
        const apiKeyAuthCount = recorded.statements.length;

        const keyTargets: [string, string][] = [
          ["GET", "/v1/seo/audits"],
          ["GET", `/v1/projects/${PROJECT_ID}/seo`],
          ["GET", "/v1/image-studio/catalog"],
          ["GET", `/v1/projects/${PROJECT_ID}/image-studio`],
          ["GET", `/v1/projects/${PROJECT_ID}/competitors`],
          ["POST", `/v1/contact-lists/${LIST_ID}/find`],
          ["POST", `/v1/contacts/${CONTACT_ID}/enrich`],
          ["GET", "/v1/cmo/cusos"],
          ["GET", "/v1/admin/soko-bots/cmo-spend"],
        ];

        for (const [method, path] of keyTargets) {
          // Preprod API key without header -> 422 mainnet_only_feature, 0 statements after auth
          recorded.statements.length = 0;
          const preprodKeyRes = await loaded.app.request(`${ORIGIN}${path}`, {
            method,
            headers: {
              origin: ORIGIN,
              authorization: `Bearer ${preprodKey}`,
              ...(method === "POST"
                ? { "content-type": "application/json" }
                : {}),
            },
            ...(method === "POST" ? { body: "{}" } : {}),
          });
          expect([method, path, preprodKeyRes.status]).toEqual([
            method,
            path,
            422,
          ]);
          expect(await preprodKeyRes.json()).toMatchObject({
            kind: CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
            message: EXPECTED_MESSAGE,
          });
          expect(recorded.statements.length).toBe(apiKeyAuthCount);

          // Mainnet key + preprod header -> 403 api_key_network_mismatch
          recorded.statements.length = 0;
          const mainnetKeyPreprodHeader = await loaded.app.request(
            `${ORIGIN}${path}`,
            {
              method,
              headers: {
                origin: ORIGIN,
                authorization: `Bearer ${mainnetKey}`,
                [HEADER]: "preprod",
                ...(method === "POST"
                  ? { "content-type": "application/json" }
                  : {}),
              },
              ...(method === "POST" ? { body: "{}" } : {}),
            },
          );
          expect([method, path, mainnetKeyPreprodHeader.status]).toEqual([
            method,
            path,
            403,
          ]);
          expect(await mainnetKeyPreprodHeader.json()).toMatchObject({
            kind: CORE_API_ERROR_KINDS.API_KEY_NETWORK_MISMATCH,
          });
          expect(recorded.statements.length).toBe(apiKeyAuthCount);

          // Preprod key + mainnet header -> 403 api_key_network_mismatch
          recorded.statements.length = 0;
          const preprodKeyMainnetHeader = await loaded.app.request(
            `${ORIGIN}${path}`,
            {
              method,
              headers: {
                origin: ORIGIN,
                authorization: `Bearer ${preprodKey}`,
                [HEADER]: "mainnet",
                ...(method === "POST"
                  ? { "content-type": "application/json" }
                  : {}),
              },
              ...(method === "POST" ? { body: "{}" } : {}),
            },
          );
          expect([method, path, preprodKeyMainnetHeader.status]).toEqual([
            method,
            path,
            403,
          ]);
          expect(await preprodKeyMainnetHeader.json()).toMatchObject({
            kind: CORE_API_ERROR_KINDS.API_KEY_NETWORK_MISMATCH,
          });
          expect(recorded.statements.length).toBe(apiKeyAuthCount);
        }

        // Mainnet API key without header gets the normal answer
        const mainnetOk = await loaded.app.request(
          `${ORIGIN}/v1/image-studio/catalog`,
          {
            headers: {
              origin: ORIGIN,
              authorization: `Bearer ${mainnetKey}`,
            },
          },
        );
        expect(mainnetOk.status).toBe(200);
      },
    );
  },
);
