import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import {
  getAdEvalsAdminOrganization,
  hasAdEvalsAdminAccess,
  requireAdEvalsAdminAccess,
} from "./ad-evals-admin-access.js";

function accessClient(member: { id: string } | null) {
  const findFirst = vi.fn().mockResolvedValue(member);
  const tx = { member: { findFirst } };
  return { tx, findFirst };
}

describe("ad evals admin organization access", () => {
  it("fails closed without a configured organization and skips the database", async () => {
    const { tx, findFirst } = accessClient({ id: "member-a" });

    expect(getAdEvalsAdminOrganization({})).toBeNull();
    await expect(hasAdEvalsAdminAccess("user-a", tx, {})).resolves.toBe(false);
    await expect(
      requireAdEvalsAdminAccess("user-a", tx, {}),
    ).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HTTPException>);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([
    {
      env: { AD_EVALS_ADMIN_ORGANIZATION_SLUG: "internal-workspace" },
      organization: { slug: "internal-workspace" },
    },
    {
      env: { AD_EVALS_ADMIN_ORGANIZATION_ID: "org-a" },
      organization: { id: "org-a" },
    },
    {
      env: {
        AD_EVALS_ADMIN_ORGANIZATION_SLUG: "internal-workspace",
        AD_EVALS_ADMIN_ORGANIZATION_ID: "org-a",
      },
      organization: { slug: "internal-workspace", id: "org-a" },
    },
  ])(
    "allows a member matching $organization",
    async ({ env, organization }) => {
      const { tx, findFirst } = accessClient({ id: "member-a" });

      expect(getAdEvalsAdminOrganization(env)).toEqual(organization);
      await expect(hasAdEvalsAdminAccess("user-a", tx, env)).resolves.toBe(
        true,
      );
      await expect(
        requireAdEvalsAdminAccess("user-a", tx, env),
      ).resolves.toBeUndefined();
      expect(findFirst).toHaveBeenCalledWith({
        where: { userId: "user-a", organization },
        select: { id: true },
      });
    },
  );

  it("denies a user who is not a member of the configured organization", async () => {
    const { tx } = accessClient(null);
    const env = { AD_EVALS_ADMIN_ORGANIZATION_SLUG: "internal-workspace" };

    await expect(hasAdEvalsAdminAccess("user-a", tx, env)).resolves.toBe(false);
    await expect(
      requireAdEvalsAdminAccess("user-a", tx, env),
    ).rejects.toMatchObject({
      status: 403,
      message:
        "Ad evals admin access requires membership in the configured workspace",
    } satisfies Partial<HTTPException>);
  });

  it("requires the same organization to match both configured fields", async () => {
    const { tx, findFirst } = accessClient(null);
    const env = {
      AD_EVALS_ADMIN_ORGANIZATION_SLUG: "internal-workspace",
      AD_EVALS_ADMIN_ORGANIZATION_ID: "different-org",
    };

    await expect(hasAdEvalsAdminAccess("user-a", tx, env)).resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-a",
        organization: { slug: "internal-workspace", id: "different-org" },
      },
      select: { id: true },
    });
  });
});
