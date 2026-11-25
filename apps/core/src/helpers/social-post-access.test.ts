import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import {
  requireSocialPostActor,
  requireSocialPostPublishingAccess,
} from "./social-post-access";

const mocks = vi.hoisted(() => ({
  binding: vi.fn(),
  capability: vi.fn(),
  beta: vi.fn(),
  workspace: vi.fn(),
  user: vi.fn(),
}));
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: mocks.binding,
}));
vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: mocks.capability,
}));
vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: mocks.beta,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: mocks.user },
    workspace: { findFirst: mocks.workspace },
  },
}));
const actor = {
  actor: "coworker" as const,
  coworkerId: "cow",
  vendorId: "vendor",
  context: { userId: "user", organizationId: "org" },
};
describe("Social post delegation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.binding.mockResolvedValue(actor.context);
    mocks.user.mockResolvedValue({
      role: "user",
      banned: false,
      banExpires: null,
    });
    mocks.workspace.mockResolvedValue({ id: "workspace" });
  });
  it("preserves creator identity after the shared binding and capability checks", async () => {
    await expect(requireSocialPostActor(actor)).resolves.toEqual({
      userId: "user",
      coworkerId: "cow",
      agent: true,
    });
    expect(mocks.binding).toHaveBeenCalledWith(actor, expect.anything());
    expect(mocks.capability).toHaveBeenCalledWith(
      "cow",
      "tasks",
      expect.anything(),
    );
  });
  it("does not bypass terminal grant denial or revocation", async () => {
    mocks.binding.mockRejectedValue(forbidden("Grant revoked"));
    await expect(requireSocialPostActor(actor)).rejects.toMatchObject({
      status: 403,
    });
    expect(mocks.capability).not.toHaveBeenCalled();
  });
  it("requires current workspace membership when delayed publication begins", async () => {
    mocks.workspace.mockResolvedValue(null);
    await expect(
      requireSocialPostPublishingAccess(actor, "workspace"),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.beta).not.toHaveBeenCalled();
    expect(mocks.workspace).toHaveBeenCalledWith({
      where: {
        id: "workspace",
        OR: [
          { userId: "user" },
          { organization: { members: { some: { userId: "user" } } } },
        ],
      },
      select: { id: true },
    });
  });
  it("allows delayed publication outside the utxo beta while checking delegation and membership", async () => {
    mocks.beta.mockRejectedValue(forbidden("Ads beta only"));

    await expect(
      requireSocialPostPublishingAccess(actor, "workspace"),
    ).resolves.toBeUndefined();
    expect(mocks.beta).not.toHaveBeenCalled();
    expect(mocks.binding).toHaveBeenCalledWith(actor, expect.anything());
    expect(mocks.capability).toHaveBeenCalledWith(
      "cow",
      "tasks",
      expect.anything(),
    );
    expect(mocks.workspace).toHaveBeenCalled();
  });
  it.each([
    null,
    { banned: true, banExpires: null },
    { banned: true, banExpires: new Date("2999-01-01") },
  ])(
    "blocks delayed publishing for a missing or banned contextual user: %j",
    async (user) => {
      mocks.user.mockResolvedValue(user);
      await expect(
        requireSocialPostPublishingAccess(actor, "workspace"),
      ).rejects.toMatchObject({ status: 403 });
      expect(mocks.beta).not.toHaveBeenCalled();
      expect(mocks.workspace).not.toHaveBeenCalled();
    },
  );
  // ADR 0077: a credential with no person at the keyboard is an agent.
  const person = {
    actor: "user" as const,
    userId: "user",
    organizationId: null,
    role: "user",
  };
  it("treats a browser session as a person", async () => {
    await expect(
      requireSocialPostActor({ ...person, authenticationMethod: "session" }),
    ).resolves.toEqual({ userId: "user", agent: false });
  });
  it.each([
    ["API key", { authenticationMethod: "api_key" as const }],
    [
      "third-party OAuth token",
      { authenticationMethod: "oauth" as const, oauthClientId: "client" },
    ],
    ["MCP token", { authenticationMethod: "oauth" as const }],
    [
      "first-party OAuth token",
      { authenticationMethod: "oauth" as const, firstPartyClient: true },
    ],
    ["credential of unknown kind", {}],
  ])("treats a %s like a Coworker", async (_name, credential) => {
    await expect(
      requireSocialPostActor({ ...person, ...credential }),
    ).resolves.toEqual({ userId: "user", agent: true });
    expect(mocks.binding).not.toHaveBeenCalled();
  });
  it("marks a Coworker as an agent", async () => {
    await expect(requireSocialPostActor(actor)).resolves.toMatchObject({
      agent: true,
    });
  });
  it("rejects a Soko Bot, which has its own Social tools", async () => {
    await expect(
      requireSocialPostActor({
        actor: "sokoBot",
        scope: "personal",
        sokoBotId: "bot",
        userId: "user",
        organizationId: null,
        workspaceId: "workspace",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
