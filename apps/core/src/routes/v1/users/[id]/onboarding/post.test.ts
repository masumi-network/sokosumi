import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "user_1";

// The user-context middleware runs above this route in production; stubbing
// the accessor keeps the test focused on the handler's own behaviour.
vi.mock("@/routes/v1/users/user-route-context", () => ({
  requireUserRouteContext: () => ({
    resolvedUserId: USER_ID,
    userContext: { userId: USER_ID },
  }),
}));

import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono";
import type { UserRouteVariables } from "@/routes/v1/users/user-route-context";

import mountPostUserOnboarding from "./post";

const { userFindUniqueMock, userUpdateMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  userUpdateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => {
  const tx = {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
  };

  return {
    default: {
      $transaction: (run: (client: typeof tx) => unknown) => run(tx),
    },
  };
});

/** Mirrors production: the route owns `/onboarding`, `:id` comes from the parent mount. */
function createApp() {
  const userRoutes = new OpenAPIHono({ defaultHook: defaultValidationHook });
  mountPostUserOnboarding(
    userRoutes as OpenAPIHonoWithAuth<UserRouteVariables>,
  );

  const app = new OpenAPIHono();
  app.route("/:id", userRoutes);
  return app;
}

function postOnboarding(body?: unknown) {
  return createApp().request(`http://localhost/${USER_ID}/onboarding`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
  });
}

/** What `update` returns; the handler re-reads the profile from it. */
function updatedUser(metadata: null | string) {
  return { metadata, onboardingCompleted: true };
}

describe("POST /users/{id}/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ metadata: null });
    userUpdateMock.mockResolvedValue(updatedUser(null));
  });

  it("completes onboarding with no body and leaves metadata alone", async () => {
    const response = await postOnboarding();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.completed).toBe(true);
    expect(body.data.profile).toEqual({
      companySize: null,
      companyType: null,
      role: null,
      workStyle: null,
    });
    expect(userUpdateMock.mock.calls[0]?.[0]?.data).toEqual({
      onboardingCompleted: true,
    });
  });

  it("stores the submitted profile answers", async () => {
    const stored = JSON.stringify({
      onboardingCompanySize: "11-50",
      onboardingCompanyType: "agency",
      onboardingRole: "founder",
      onboardingWorkStyle: "team",
    });
    userUpdateMock.mockResolvedValue(updatedUser(stored));

    const response = await postOnboarding({
      profile: {
        companySize: "11-50",
        companyType: "agency",
        role: "founder",
        workStyle: "team",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.profile).toEqual({
      companySize: "11-50",
      companyType: "agency",
      role: "founder",
      workStyle: "team",
    });
    expect(
      JSON.parse(userUpdateMock.mock.calls[0]?.[0]?.data.metadata),
    ).toEqual({
      onboardingCompanySize: "11-50",
      onboardingCompanyType: "agency",
      onboardingRole: "founder",
      onboardingWorkStyle: "team",
    });
  });

  it("merges into existing metadata instead of replacing it", async () => {
    userFindUniqueMock.mockResolvedValue({
      metadata: JSON.stringify({
        designMdUrl: "https://example.com/DESIGN.md",
        url: "https://example.com",
      }),
    });

    await postOnboarding({ profile: { role: "marketing" } });

    expect(
      JSON.parse(userUpdateMock.mock.calls[0]?.[0]?.data.metadata),
    ).toEqual({
      designMdUrl: "https://example.com/DESIGN.md",
      onboardingRole: "marketing",
      url: "https://example.com",
    });
  });

  it("accepts a partial profile without clearing unmentioned answers", async () => {
    userFindUniqueMock.mockResolvedValue({
      metadata: JSON.stringify({ onboardingCompanyType: "saas" }),
    });

    await postOnboarding({ profile: { role: "product" } });

    expect(
      JSON.parse(userUpdateMock.mock.calls[0]?.[0]?.data.metadata),
    ).toEqual({
      onboardingCompanyType: "saas",
      onboardingRole: "product",
    });
  });

  it("rejects an answer outside the shared vocabulary", async () => {
    const response = await postOnboarding({
      profile: { role: "supreme-overlord" },
    });

    expect(response.status).toBe(422);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
