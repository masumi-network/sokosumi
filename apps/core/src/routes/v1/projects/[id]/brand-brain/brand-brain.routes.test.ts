import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mountAnswer from "./answers/post";
import mountConfirm from "./confirm/post";
import mountGet from "./get";
import mountPut from "./put";

const m = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  brainFindUnique: vi.fn(),
  brainUpsert: vi.fn(),
  brainUpdate: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    project: { findFirst: m.projectFindFirst },
    brandBrain: {
      findUnique: m.brainFindUnique,
      upsert: m.brainUpsert,
      update: m.brainUpdate,
    },
    $executeRaw: m.executeRaw,
    $transaction: (callback: (tx: unknown) => unknown) => callback(client),
  };
  return { default: client };
});

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const BASE = `http://localhost/${PROJECT_ID}/brand-brain`;
const AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: "organization_1",
  role: "user",
  authenticationMethod: "session",
};
const WORKSPACE: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: "user_1",
  organizationId: "organization_1",
};
const QUESTION = {
  id: "found-via-google",
  question: "Do most customers find you through Google?",
  statement: "Most customers find the business through Google",
  section: "marketing" as const,
};
const BRAIN = {
  summary: "Acme sells rockets.",
  voice: { tone: "Direct", do: [], dont: [], examples: [] },
  audience: ["Founders"],
  products: ["Rockets"],
  competitors: [],
  channels: [],
  questions: [QUESTION],
};
const SAVED_AT = new Date("2026-10-20T10:00:00.000Z");

function createApp(workspaceContext: WorkspaceContext | null = WORKSPACE) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("requestId", "brand_brain_test");
    c.set("isAuthenticated", true);
    c.set("authContext", AUTH);
    c.set("workspaceContext", workspaceContext);
    await next();
  });
  mountGet(app);
  mountPut(app);
  mountConfirm(app);
  mountAnswer(app);
  app.onError(errorHandler);
  return app;
}

function json(method: "POST" | "PUT", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function stored(extra: object = {}) {
  return {
    id: "brain_1",
    body: BRAIN,
    updatedAt: SAVED_AT,
    confirmedAt: null,
    confirmedBy: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.projectFindFirst.mockResolvedValue({
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    workspace: { userId: "user_1", organizationId: null },
  });
  m.brainFindUnique.mockResolvedValue(stored());
  m.brainUpdate.mockImplementation(async (args) => ({
    ...stored(),
    ...args.data,
  }));
});

describe("Brand Brain on the Project", () => {
  it("reads the Project's Brand Brain with who confirmed it", async () => {
    const confirmedAt = new Date("2026-10-21T09:00:00.000Z");
    m.brainFindUnique.mockResolvedValue(
      stored({ confirmedAt, confirmedBy: { id: "user_2", name: "Grace" } }),
    );

    const response = await createApp().request(BASE);

    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({
      brandBrain: { summary: "Acme sells rockets." },
      updatedAt: SAVED_AT.toISOString(),
      confirmedAt: confirmedAt.toISOString(),
      confirmedBy: { id: "user_2", name: "Grace" },
    });
  });

  it("reads null before anyone saved the essentials", async () => {
    m.brainFindUnique.mockResolvedValue(
      stored({ body: { profile: {} }, updatedAt: null }),
    );

    const response = await createApp().request(BASE);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      brandBrain: null,
      updatedAt: null,
      confirmedAt: null,
      confirmedBy: null,
    });
  });

  it("saves a member's edit into the Project's Brand Brain", async () => {
    m.brainFindUnique.mockResolvedValueOnce(null);
    m.brainUpsert.mockResolvedValue({});
    m.brainFindUnique.mockResolvedValueOnce(stored());

    const response = await createApp().request(
      BASE,
      json("PUT", {
        brandBrain: { ...BRAIN, summary: "Acme sells boosters." },
      }),
    );

    expect(response.status).toBe(200);
    const upsert = m.brainUpsert.mock.lastCall?.[0];
    expect(upsert.where).toEqual({ projectId: PROJECT_ID });
    expect(upsert.create.body.summary).toBe("Acme sells boosters.");
    expect(upsert.update.updatedAt).toBeInstanceOf(Date);
  });

  it("records the member who confirmed it", async () => {
    const response = await createApp().request(`${BASE}/confirm`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const update = m.brainUpdate.mock.lastCall?.[0];
    expect(update.where).toEqual({ projectId: PROJECT_ID });
    expect(update.data.confirmedByUserId).toBe("user_1");
    expect(update.data.confirmedAt).toBeInstanceOf(Date);
  });

  it("refuses to confirm a Brand Brain without its essentials", async () => {
    m.brainFindUnique.mockResolvedValue(stored({ body: { profile: {} } }));

    const response = await createApp().request(`${BASE}/confirm`, {
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(m.brainUpdate).not.toHaveBeenCalled();
  });

  it("lands a member's yes in its section as a confirmed finding", async () => {
    const response = await createApp().request(
      `${BASE}/answers`,
      json("POST", { questionId: QUESTION.id, answer: "yes" }),
    );

    expect(response.status).toBe(200);
    const body = m.brainUpdate.mock.calls[0]?.[0].data.body;
    expect(body.questions[0].answer).toBe("yes");
    expect(body.profile.marketing.findings[0]).toMatchObject({
      point: QUESTION.statement,
      evidence: "fact",
    });
  });

  it("refuses an answer to a question that is not there", async () => {
    const response = await createApp().request(
      `${BASE}/answers`,
      json("POST", { questionId: "nope", answer: "yes" }),
    );

    expect(response.status).toBe(404);
    expect(m.brainUpdate).not.toHaveBeenCalled();
  });

  it("refuses a Project outside the caller's Workspace", async () => {
    m.projectFindFirst.mockResolvedValue(null);
    const app = createApp();

    const responses = await Promise.all([
      app.request(BASE),
      app.request(BASE, json("PUT", { brandBrain: BRAIN })),
      app.request(`${BASE}/confirm`, { method: "POST" }),
      app.request(
        `${BASE}/answers`,
        json("POST", { questionId: QUESTION.id, answer: "yes" }),
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404,
    ]);
    expect(m.projectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      }),
    );
    expect(m.brainFindUnique).not.toHaveBeenCalled();
    expect(m.brainUpsert).not.toHaveBeenCalled();
    expect(m.brainUpdate).not.toHaveBeenCalled();
  });

  it("refuses a caller who is no member of a Workspace", async () => {
    const response = await createApp(null).request(BASE);

    expect(response.status).toBe(403);
    expect(m.brainFindUnique).not.toHaveBeenCalled();
  });
});
