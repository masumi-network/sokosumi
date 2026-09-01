import { describe, expect, it } from "vitest";

import { testVendor } from "@/test-fixtures/vendor";

import { mapCoworker } from "./coworker";

const baseCoworker = {
  id: "cow_123",
  createdAt: new Date("2026-02-25T10:00:00.000Z"),
  updatedAt: new Date("2026-02-25T10:00:00.000Z"),
  archivedAt: null,
  isWhitelisted: true,
  priority: 10,
  capabilities: ["chat", "tasks"],
  slug: "ops-agent",
  name: "Ops Agent",
  caption: null,
  url: null,
  description: null,
  image: null,
  baseURL: null,
  metadata: null,
  vendorId: testVendor.id,
  sokoBotId: null,
  vendor: testVendor,
  sokoBot: null,
};

describe("mapCoworker", () => {
  it("exposes a null personal assistant owner for marketplace coworkers", () => {
    const result = mapCoworker(baseCoworker);

    expect(result.sokoBotId).toBeNull();
    expect(result.ownerUserId).toBeNull();
  });

  it("maps the Soko Bot owner onto personal assistant coworkers", () => {
    const result = mapCoworker({
      ...baseCoworker,
      id: "cow_jarvis",
      slug: "jarvis",
      name: "Jarvis",
      sokoBotId: "01960001-0001-7001-8001-000000000099",
      sokoBot: { userId: "user_ada" },
    });

    expect(result.sokoBotId).toBe("01960001-0001-7001-8001-000000000099");
    expect(result.ownerUserId).toBe("user_ada");
  });
});
