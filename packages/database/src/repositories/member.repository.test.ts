import { expect, it, vi } from "vitest";

import { memberRepository } from "./member.repository.js";

it("lists the first page of members within the organization without a cursor or offset", async () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const tx = {
    member: { findMany, count: vi.fn().mockResolvedValue(0) },
  } as never;

  await memberRepository.listMembersForAdminOverview(
    { organizationId: "org-1", take: 21 },
    tx,
  );

  const query = findMany.mock.lastCall?.[0];
  expect(query.where).toStrictEqual({ organizationId: "org-1" });
  expect(query).not.toHaveProperty("cursor");
  expect(query).not.toHaveProperty("skip");
});
