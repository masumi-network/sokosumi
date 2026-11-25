import { waitUntil } from "@vercel/functions";
import { type Context, Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NetworkScope } from "@/lib/db/network-scope";

import {
  handleSyncRequest,
  type NetworkSyncRunContext,
  type SyncRequestOptions,
  type SyncRunContext,
} from "./handler";

const { acquireLock, releaseLock, networkPrisma, sharedTransaction } =
  vi.hoisted(() => ({
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    networkPrisma: vi.fn(),
    sharedTransaction: vi.fn(),
  }));
vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: { acquireLock, releaseLock },
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { $transaction: sharedTransaction },
  networkPrisma,
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

const AUTHORIZED = { headers: { Authorization: "Bearer test-cron-secret" } };

/** One cron route; an error its handler throws becomes the 500 body. */
function request(
  cron: (c: Context) => Promise<Response>,
  init: RequestInit = AUTHORIZED,
) {
  const app = new Hono();
  app.onError((error, c) => c.text(error.message, 500));
  app.get("/", cron);
  return app.request("http://localhost/", init);
}

/** The work the handler handed to `waitUntil` for the last request. */
function deferredWork() {
  return vi.mocked(waitUntil).mock.lastCall?.[0];
}

describe("handleSyncRequest with a Network", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireLock.mockResolvedValue({ key: "lock-key", ownerToken: "owner" });
    releaseLock.mockResolvedValue(true);
  });

  it("hands the work the scope of the Network the cron declared", async () => {
    const work = vi.fn(async (_context: NetworkSyncRunContext) => {});

    const response = await request((c) =>
      handleSyncRequest(c, "lock-key", work, { network: "mainnet" }),
    );
    await deferredWork();

    expect(response.status).toBe(200);
    expect(work.mock.lastCall?.[0].scope.network).toBe("mainnet");
  });

  it("hands the work no scope when the cron declared no Network", async () => {
    const work = vi.fn(async (_context: SyncRunContext) => {});

    await request((c) => handleSyncRequest(c, "lock-key", work));
    await deferredWork();

    expect(work).toHaveBeenCalledTimes(1);
    expect(work.mock.lastCall?.[0]).not.toHaveProperty("scope");
  });

  // Preprod is off in a unit run, so creating its scope throws: where the
  // handler creates the scope shows in what a Preprod cron answers.
  it("checks the secret before it creates the scope", async () => {
    const response = await request(
      (c) =>
        handleSyncRequest(c, "lock-key", async () => {}, {
          network: "preprod",
        }),
      {},
    );

    expect(response.status).toBe(401);
  });

  it("creates the scope before it takes the lock", async () => {
    const work = vi.fn();

    const response = await request((c) =>
      handleSyncRequest(c, "lock-key", work, { network: "preprod" }),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("Preprod is off");
    expect(acquireLock).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it("lets the deferred work use the scope after the response, and opens no client or transaction for it", async () => {
    const client = { $transaction: vi.fn() };
    networkPrisma.mockReturnValue(client);
    let respond = () => {};
    const responded = new Promise<void>((resolve) => {
      respond = resolve;
    });
    const read = vi.fn();
    const work = async (context: NetworkSyncRunContext) => {
      await responded;
      read(context.scope.networkDb);
    };

    const response = await request((c) =>
      handleSyncRequest(c, "lock-key", work, { network: "mainnet" }),
    );

    try {
      expect(response.status).toBe(200);
      expect(networkPrisma).not.toHaveBeenCalled();
    } finally {
      respond();
    }
    await deferredWork();
    expect(read).toHaveBeenCalledExactlyOnceWith(client);
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(sharedTransaction).not.toHaveBeenCalled();
  });
});

/**
 * Never called: `tsc` checks it. Each `@ts-expect-error` is a use that must
 * not compile, so a cron that declares no Network is handed no scope.
 */
export function _noScopeWithoutTheNetworkOption(c: Context) {
  const takesScope = (_scope: NetworkScope) => {};

  void handleSyncRequest(
    c,
    "lock-key",
    async (context) => takesScope(context.scope),
    { network: "mainnet" },
  );
  void handleSyncRequest(
    c,
    "lock-key",
    async (context) => takesScope(context.scope),
    { network: "mainnet", errorDetail: "cause" },
  );

  void handleSyncRequest(c, "lock-key", async (context) => {
    // @ts-expect-error no options, no scope
    void context.scope;
  });
  void handleSyncRequest(
    c,
    "lock-key",
    async (context) => {
      // @ts-expect-error `errorDetail` declares no Network
      void context.scope;
    },
    { errorDetail: "cause" },
  );
  const runContext = {} as SyncRunContext;
  // @ts-expect-error the run context of a cron without a Network has no scope
  void runContext.scope;
  void handleSyncRequest(c, "lock-key", async () => {}, {
    // @ts-expect-error a Network is one of the known ones
    network: "testnet",
  });

  // The same Network outside the call: a variable and a spread are not
  // checked for extra properties, so the plain options must refuse them.
  const wrongNetwork = { errorDetail: "cause", network: "testnet" } as const;
  // @ts-expect-error a variable that carries an unknown Network
  void handleSyncRequest(c, "lock-key", async () => {}, wrongNetwork);
  // @ts-expect-error ... and its spread
  void handleSyncRequest(c, "lock-key", async () => {}, { ...wrongNetwork });
  // @ts-expect-error plain options cannot hide an unknown Network
  const widenedWrong: SyncRequestOptions = wrongNetwork;
  // @ts-expect-error ... nor a known one, which would run without its scope
  const widened: SyncRequestOptions = { network: "mainnet" };
  void [widenedWrong, widened];
}
