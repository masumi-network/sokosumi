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
vi.mock("@/helpers/calendar-beta-access", () => ({
  requireCalendarBetaAccess: mocks.beta,
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
    expect(mocks.beta).toHaveBeenCalledWith("user", expect.anything());
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
  it.each(["api_key", "oauth"] as const)(
    "does not enable human %s credentials",
    async (authenticationMethod) => {
      await expect(
        requireSocialPostActor({
          actor: "user",
          userId: "user",
          organizationId: null,
          role: "user",
          authenticationMethod,
        }),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
});
