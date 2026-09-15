import { describe, expect, it } from "vitest";

import { resolveTaskEventActorFields } from "./task-event-actor";

describe("resolveTaskEventActorFields", () => {
  it("attributes a session user", () => {
    const fields = resolveTaskEventActorFields({
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    });

    expect(fields).toEqual({
      userId: "user_123",
      coworkerId: null,
      sokoBotId: null,
    });
  });

  it("attributes a coworker to the coworker, not the contextual user", () => {
    const fields = resolveTaskEventActorFields({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: "org_123" },
    });

    expect(fields).toEqual({
      userId: null,
      coworkerId: "cow_123",
      sokoBotId: null,
    });
  });

  it("attributes a Soko Bot", () => {
    const fields = resolveTaskEventActorFields({
      actor: "sokoBot",
      sokoBotId: "01960001-0001-7001-8001-000000000099",
      userId: "user_123",
      workspaceId: "11111111-1111-7111-8111-111111111111",
      organizationId: null,
    });

    expect(fields).toEqual({
      userId: null,
      coworkerId: null,
      sokoBotId: "01960001-0001-7001-8001-000000000099",
    });
  });
});
