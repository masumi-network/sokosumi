import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthOrganizationPlugin } from "./auth-organization";

const mocks = vi.hoisted(() => {
  const waitUntilPromises: Promise<unknown>[] = [];
  return {
    captureException: vi.fn(),
    deliverCalendarInvalidations: vi.fn(),
    ensureFreeSubscription: vi.fn(),
    ensurePersonalWorkspace: vi.fn(),
    guardOrganizationCreate: vi.fn((organization) => organization),
    listExitRoomIds: vi.fn(),
    pinPreferredOrganization: vi.fn(),
    prepareOrganizationForDeletion: vi.fn(),
    prisma: {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ tx: true }),
      ),
    },
    publishExitRevocation: vi.fn(),
    createOrganizationCustomer: vi.fn(),
    upgradeGuestMemberships: vi.fn(),
    upsertOrganizationWorkspace: vi.fn(),
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
    }),
    waitUntilPromises,
  };
});

vi.mock("@sentry/node", () => ({ captureException: mocks.captureException }));
vi.mock("@vercel/functions", () => ({ waitUntil: mocks.waitUntil }));
vi.mock("@sokosumi/database/helpers", () => ({
  ensureInitialLocalFreeSubscriptionPeriod: mocks.ensureFreeSubscription,
}));
vi.mock("@sokosumi/database/repositories", () => ({
  workspaceRepository: {
    upsertOrganizationWorkspace: mocks.upsertOrganizationWorkspace,
  },
}));
vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    createOrganizationCustomer: mocks.createOrganizationCustomer,
  },
}));
vi.mock("@/config/env", () => ({
  getWebAppBaseUrl: () => "https://app.sokosumi.test",
}));
vi.mock("@/helpers/background-email", () => ({
  sendEmailInBackground: vi.fn(),
}));
vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverOrganizationCalendarInvalidationsNow:
    mocks.deliverCalendarInvalidations,
}));
vi.mock("@/helpers/chat-room-guest-upgrade", () => ({
  upgradeGuestChatRoomMembershipsToMember: mocks.upgradeGuestMemberships,
}));
vi.mock("@/helpers/chat-room-organization-exit", () => ({
  listOrganizationExitChatRoomIdsForAbly: mocks.listExitRoomIds,
  publishOrganizationExitChatRevocation: mocks.publishExitRevocation,
}));
vi.mock("@/helpers/design-md-metadata-auth", () => ({
  applyDesignMdMetadataGuardToOrganizationCreate: mocks.guardOrganizationCreate,
  applyDesignMdMetadataGuardToOrganizationUpdate: vi.fn(),
}));
vi.mock("@/helpers/org-membership-personal-workspace", () => ({
  ensurePersonalWorkspaceForOrganizationMembership:
    mocks.ensurePersonalWorkspace,
  pinPreferredOrganizationIfUnset: mocks.pinPreferredOrganization,
}));
vi.mock("@/helpers/organization-deletion", () => ({
  prepareOrganizationForDeletion: mocks.prepareOrganizationForDeletion,
}));
vi.mock("@/helpers/stripe-customer-delete", () => ({
  deleteStripeCustomerBestEffort: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: mocks.prisma }));

const organization = {
  id: "org-1",
  name: "Org One",
  slug: "org-one",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
};
const user = {
  id: "user-1",
  name: "Owner",
  email: "owner@example.com",
  emailVerified: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

function plugin() {
  return createAuthOrganizationPlugin().options;
}

// The plugin's input types are wider than these hooks read.
function hooks() {
  return plugin().organizationHooks as unknown as Record<
    string,
    (input: Record<string, unknown>) => Promise<unknown>
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.waitUntilPromises.length = 0;
  mocks.ensurePersonalWorkspace.mockResolvedValue(undefined);
  mocks.createOrganizationCustomer.mockResolvedValue({ id: "cus_org_1" });
});

afterEach(async () => {
  await Promise.allSettled(mocks.waitUntilPromises);
});

it("keeps stripeCustomerId out of what a request may set on an organization", () => {
  expect(plugin().schema?.organization?.additionalFields).toEqual({
    stripeCustomerId: {
      type: "string",
      required: false,
      defaultValue: null,
      input: false,
    },
  });
});

describe("organization creation", () => {
  it("checks the personal workspace before applying organization metadata", async () => {
    const draft = { name: "Workspace", slug: "workspace" };

    await expect(
      hooks().beforeCreateOrganization({ organization: draft, user }),
    ).resolves.toEqual({ data: draft });

    expect(mocks.ensurePersonalWorkspace).toHaveBeenCalledWith(user.id);
    expect(mocks.guardOrganizationCreate).toHaveBeenCalledWith(draft);
    expect(
      mocks.ensurePersonalWorkspace.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.guardOrganizationCreate.mock.invocationCallOrder[0]);
  });

  it("propagates workspace failure before processing organization metadata", async () => {
    const error = new Error("Workspace unavailable");
    mocks.ensurePersonalWorkspace.mockRejectedValue(error);

    await expect(
      hooks().beforeCreateOrganization({
        organization: { name: "Workspace", slug: "workspace" },
        user,
      }),
    ).rejects.toBe(error);
    expect(mocks.guardOrganizationCreate).not.toHaveBeenCalled();
  });

  it("creates the workspace, pins it as preferred and seeds the free subscription", async () => {
    await hooks().afterCreateOrganization({ organization, user });

    expect(mocks.upsertOrganizationWorkspace).toHaveBeenCalledWith({
      organizationId: "org-1",
      tx: { tx: true },
    });
    expect(mocks.pinPreferredOrganization).toHaveBeenCalledWith(
      "user-1",
      "org-1",
    );
    expect(mocks.ensureFreeSubscription).toHaveBeenCalledWith(
      {
        createdAt: organization.createdAt,
        kind: "organization",
        organizationId: "org-1",
        stripeCustomerId: null,
      },
      { tx: true },
    );
  });

  it.each([
    [
      "workspace",
      mocks.upsertOrganizationWorkspace,
      "workspace_organization_creation",
    ],
    [
      "free subscription",
      mocks.ensureFreeSubscription,
      "organization_free_subscription_seed",
    ],
  ])(
    "reports a failed %s to Sentry without failing creation",
    async (_label, step, context) => {
      step.mockRejectedValueOnce(new Error("failed"));

      await expect(
        hooks().afterCreateOrganization({ organization, user }),
      ).resolves.toBeUndefined();

      expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
        extra: { organizationId: "org-1", organizationName: "Org One" },
        tags: { context },
      });
    },
  );

  // The response does not wait for Stripe, but the function must.
  it("keeps the new organization's Stripe customer creation alive past the response", async () => {
    let finishStripe!: () => void;
    mocks.createOrganizationCustomer.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishStripe = resolve;
      }),
    );

    await hooks().afterCreateOrganization({ organization, user });

    // The hook returned while Stripe is still working; the kept promise
    // settles only once Stripe does.
    expect(mocks.createOrganizationCustomer).toHaveBeenCalledExactlyOnceWith({
      organizationId: "org-1",
      slug: "org-one",
      name: "Org One",
    });
    expect(mocks.waitUntil).toHaveBeenCalledOnce();
    const [[kept]] = mocks.waitUntil.mock.calls;
    let settled = false;
    void kept.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    finishStripe();
    await kept;
    expect(settled).toBe(true);
  });

  it("reports Stripe organization customer creation failures to Sentry", async () => {
    mocks.createOrganizationCustomer.mockRejectedValueOnce(
      new Error("stripe org failed"),
    );

    await hooks().afterCreateOrganization({ organization, user });
    await Promise.all(mocks.waitUntilPromises);

    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: {
        organizationId: "org-1",
        organizationName: "Org One",
        organizationSlug: "org-one",
      },
      tags: { context: "stripe_organization_customer_creation" },
    });
  });
});

describe.each(["beforeAddMember", "beforeAcceptInvitation"])("%s", (hook) => {
  it("ensures the person's personal workspace for that organization", async () => {
    await hooks()[hook]({ organization, user });

    expect(mocks.ensurePersonalWorkspace).toHaveBeenCalledWith("user-1", {
      organizationId: "org-1",
    });
  });

  it("refuses when the personal workspace cannot be ensured", async () => {
    mocks.ensurePersonalWorkspace.mockRejectedValueOnce(
      new Error("personal workspace failed"),
    );

    await expect(hooks()[hook]({ organization, user })).rejects.toThrow(
      "personal workspace failed",
    );
  });
});

it.each(["afterAddMember", "afterAcceptInvitation"])(
  "upgrades guest chat memberships in %s",
  async (hook) => {
    await hooks()[hook]({ organization, user });

    expect(mocks.upgradeGuestMemberships).toHaveBeenCalledWith(
      "user-1",
      "org-1",
    );
  },
);

it("hands Ably room ids through the member object around remove", async () => {
  mocks.listExitRoomIds.mockResolvedValue(["room-a", "room-b"]);
  const member: { organizationExitChatRoomIds?: string[] } = {};

  await hooks().beforeRemoveMember({ organization, user, member });
  expect(member.organizationExitChatRoomIds).toEqual(["room-a", "room-b"]);
  await hooks().afterRemoveMember({ organization, user, member });

  expect(mocks.listExitRoomIds).toHaveBeenCalledWith("user-1", "org-1");
  expect(mocks.publishExitRevocation).toHaveBeenCalledWith("user-1", {
    revokedRoomIds: ["room-a", "room-b"],
    statusMessages: [],
  });
  expect(mocks.deliverCalendarInvalidations).toHaveBeenCalledWith(
    "org-1",
    "user-1",
  );
});

// `prepareOrganizationForDeletion` has its own tests for each refusal.
it("refuses a deletion the organization is not ready for", async () => {
  const refusal = {
    status: "BAD_REQUEST",
    body: { code: "LAST_WORKSPACE", message: "Cannot delete." },
  };
  mocks.prepareOrganizationForDeletion.mockRejectedValue(refusal);

  await expect(
    hooks().beforeDeleteOrganization({ organization: { id: "org-1" }, user }),
  ).rejects.toBe(refusal);
  expect(mocks.prepareOrganizationForDeletion).toHaveBeenCalledWith(
    "org-1",
    "user-1",
    mocks.prisma,
  );
});
