import { describe, expect, it } from "vitest";
import { mapDbCoworkerToChatCoworker } from "../coworker-utils";

describe("mapDbCoworkerToChatCoworker", () => {
  it("keeps the coworker slug on the chat shape", () => {
    expect(
      mapDbCoworkerToChatCoworker({
        id: "cow_123",
        slug: "elena",
        name: "Elena",
        description: "Ops helper",
        archivedAt: null,
        isWhitelisted: false,
        image: null,
        caption: null,
        company: null,
        companyLogo: null,
        url: null,
        baseURL: null,
        capabilities: [],
        metadata: null,
        createdAt: new Date("2026-03-06T00:00:00.000Z"),
        updatedAt: new Date("2026-03-06T00:00:00.000Z"),
      }),
    ).toMatchObject({
      id: "cow_123",
      slug: "elena",
      name: "Elena",
      description: "Ops helper",
      useCase: "",
    });
  });
});
