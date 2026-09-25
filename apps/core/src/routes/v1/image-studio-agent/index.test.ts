import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The versioned agent surface, held to the contract it advertises.
 *
 * A standards review found this router documenting `jsonErrorResponse` —
 * `{error, message, meta}` — while serving `{ok:false,error:"unauthorized"}`
 * for a rejected grant and Zod's own `{success:false,error:{…}}` for an
 * invalid body. Both are now the documented envelope, without changing who may
 * call: the grant check is still agent-audience only, and still re-derives the
 * caller's live project access.
 *
 * Composed the way production composes it — mounted under an app carrying
 * `requestId` and Core's error handler — because that composition is what
 * renders the envelope.
 */

const state = vi.hoisted(() => ({
  secret: "test-secret-value-not-live-".repeat(2),
  access: vi.fn(),
  register: vi.fn(),
  recordInitialTurn: vi.fn(),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      IMAGE_STUDIO_AGENT_SECRET: state.secret,
    }),
  };
});
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccessForUser: state.access,
}));
vi.mock("@/services/image-studio-sessions.service", () => ({
  registerCreatedSession: state.register,
  recordInitialTurn: state.recordInitialTurn,
}));

import { errorResponseSchema } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { mintAgentGrant } from "@/lib/image-studio/agent-grant";
import router from "@/routes/v1/image-studio-agent/index";

const app = new Hono();
app.use(requestId());
app.onError(errorHandler);
app.route("/v1/image-studio-agent", router);

function token(audience: "agent" | "browser", ttlSeconds = 120): string {
  return mintAgentGrant(
    { userId: "user-a", projectId: "project-a", audience, ttlSeconds },
    state.secret,
  );
}

async function post(
  path: string,
  bearer: string | undefined,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const response = await app.request(`/v1/image-studio-agent${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.secret = "test-secret-value-not-live-".repeat(2);
  state.access.mockResolvedValue({
    userId: "user-a",
    projectId: "project-a",
    workspaceId: "workspace-a",
  });
  state.register.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    eveSessionId: "wrun_A",
    wasCreated: true,
    initialTurn: "CLAIMED",
    mayDeliver: true,
    deliveryToken: "lease-1",
  });
  state.recordInitialTurn.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    eveSessionId: "wrun_A",
    initialTurn: "DELIVERED",
    accepted: true,
  });
});

describe("recording a conversation", () => {
  it("answers the documented envelope when the grant is missing or wrong", async () => {
    for (const bearer of [undefined, token("browser"), token("agent", -1)]) {
      const { status, json } = await post("/sessions", bearer, {
        eveSessionId: "wrun_A",
      });

      expect(status).toBe(401);
      expect(errorResponseSchema.safeParse(json).success).toBe(true);
    }
    // Nothing behind the door was touched.
    expect(state.access).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
  });

  it("answers the documented envelope when the body does not validate", async () => {
    const { status, json } = await post("/sessions", token("agent"), {
      eveSessionId: 4,
    });

    // The shared validation hook, so this reads like every other /v1 route.
    expect(status).toBe(422);
    expect(errorResponseSchema.safeParse(json).success).toBe(true);
    expect(state.register).not.toHaveBeenCalled();
  });

  it("answers the documented envelope when the surface is switched off", async () => {
    state.secret = "";

    const { status, json } = await post("/sessions", token("agent"), {
      eveSessionId: "wrun_A",
    });

    // Off, not open — and said in the documented shape rather than a raw one.
    expect(status).toBe(503);
    expect(errorResponseSchema.safeParse(json).success).toBe(true);
  });

  it("records the conversation for a valid agent grant", async () => {
    const { status, json } = await post("/sessions", token("agent"), {
      eveSessionId: "wrun_A",
      clientIntentId: "intent-1",
      expectsInitialTurn: true,
    });

    expect(status).toBe(201);
    expect(json).toMatchObject({
      data: {
        eveSessionId: "wrun_A",
        created: true,
        initialTurn: "CLAIMED",
        mayDeliver: true,
        deliveryToken: "lease-1",
      },
    });
    expect(state.register).toHaveBeenCalledWith(
      expect.objectContaining({
        eveSessionId: "wrun_A",
        clientIntentId: "intent-1",
        expectsInitialTurn: true,
      }),
    );
  });
});

describe("closing out the first delivery", () => {
  it("requires the same agent grant", async () => {
    const { status, json } = await post(
      "/sessions/wrun_A/initial-turn",
      token("browser"),
      { outcome: "delivered" },
    );

    expect(status).toBe(401);
    expect(errorResponseSchema.safeParse(json).success).toBe(true);
    expect(state.recordInitialTurn).not.toHaveBeenCalled();
  });

  it("records an outcome the schema allows", async () => {
    const { status, json } = await post(
      "/sessions/wrun_A/initial-turn",
      token("agent"),
      { outcome: "undelivered", deliveryToken: "lease-1" },
    );

    expect(status).toBe(200);
    expect(json).toMatchObject({
      data: { initialTurn: "DELIVERED", accepted: true },
    });
    expect(state.recordInitialTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        eveSessionId: "wrun_A",
        outcome: "undelivered",
        deliveryToken: "lease-1",
      }),
    );
  });

  it("refuses an outcome it does not define", async () => {
    const { status, json } = await post(
      "/sessions/wrun_A/initial-turn",
      token("agent"),
      { outcome: "probably" },
    );

    expect(status).toBe(422);
    expect(errorResponseSchema.safeParse(json).success).toBe(true);
    expect(state.recordInitialTurn).not.toHaveBeenCalled();
  });
});
