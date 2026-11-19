import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { MAX_SEEN_SIDEBAR_ITEMS } from "@/schemas/sidebar-layout.schema";
import { createPreferencesApp, patchRequest } from "./preferences.test-app.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID();
const otherUserId = randomUUID();
const layout = {
  sections: [
    { id: "marketing", name: "Marketing", items: ["future-feature", "social"] },
  ],
  hidden: ["tasks"],
};

function preferencesForUser(id: string) {
  const app = createPreferencesApp({
    actor: "user",
    role: "user",
    userId: id,
    organizationId: null,
  });
  const patch = (body: unknown) =>
    app.request(patchRequest("/me/preferences", body));
  async function read() {
    const response = await app.request("http://localhost/me/preferences");
    expect(response.status).toBe(200);
    return (await response.json()).data;
  }

  return { patch, read };
}

describe.skipIf(!enabled)("sidebar account preferences", () => {
  const { patch, read } = preferencesForUser(userId);

  beforeEach(async () => {
    await prisma.user.createMany({
      data: [userId, otherUserId].map((id) => ({
        id,
        name: "Sidebar fixture",
        email: `${id}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    });
  });
  afterEach(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [userId, otherUserId] } },
    });
  });

  it("keeps simultaneous layout edits and first visits, including a repeated visit", async () => {
    expect(await read()).toMatchObject({
      sidebarLayout: null,
      sidebarSeenItems: [],
    });
    const writes = await Promise.all([
      patch({ sidebarLayout: layout }),
      patch({ sidebarSeenItem: "social" }),
      patch({ sidebarSeenItem: "social" }),
      patch({ sidebarSeenItem: "future-feature" }),
    ]);
    expect(writes.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const saved = await read();
    expect(saved.sidebarLayout).toEqual(layout);
    expect(saved.sidebarSeenItems.sort()).toEqual(["future-feature", "social"]);
    expect((await patch({ sidebarLayout: null })).status).toBe(200);
    const restored = await read();
    expect(restored.sidebarLayout).toBeNull();
    expect(restored.sidebarSeenItems.sort()).toEqual([
      "future-feature",
      "social",
    ]);
  });

  it("keeps one account's layout and seen items when another account resets", async () => {
    const other = preferencesForUser(otherUserId);
    expect(
      (await patch({ sidebarLayout: layout, sidebarSeenItem: "social" }))
        .status,
    ).toBe(200);
    expect(await other.read()).toMatchObject({
      sidebarLayout: null,
      sidebarSeenItems: [],
    });
    expect(
      (await other.patch({ sidebarLayout: null, sidebarSeenItem: "channels" }))
        .status,
    ).toBe(200);
    expect(await read()).toMatchObject({
      sidebarLayout: layout,
      sidebarSeenItems: ["social"],
    });
    expect(await other.read()).toMatchObject({
      sidebarLayout: null,
      sidebarSeenItems: ["channels"],
    });
  });

  it("admits repeats at the seen limit and rolls back a combined save for a new item", async () => {
    const history = Array.from(
      { length: MAX_SEEN_SIDEBAR_ITEMS },
      (_, i) => `item-${i}`,
    );
    await prisma.user.update({
      where: { id: userId },
      data: { sidebarSeenItems: history },
    });
    expect((await patch({ sidebarSeenItem: history[0] })).status).toBe(200);
    expect(
      (await patch({ sidebarSeenItem: "one-more", sidebarLayout: layout }))
        .status,
    ).toBe(422);
    expect(await read()).toMatchObject({
      sidebarLayout: null,
      sidebarSeenItems: history,
    });
  });
});
