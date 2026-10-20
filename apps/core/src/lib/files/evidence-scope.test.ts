import { describe, expect, it, vi } from "vitest";

import { fileActorFingerprint } from "@/lib/files/actor";
import { buildAuthorizedResourceSql } from "@/lib/files/evidence-scope";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const SCOPE = {
  sokoBotId: "bot-1",
  workspaceId: "ws-1",
  projectId: "project-1",
};
const member = {
  userId: "member-1",
  organizationId: null,
  kind: "soko_bot" as const,
};

describe("buildAuthorizedResourceSql for a Soko Bot", () => {
  it("keeps a personal bot's reach: its Drive and the member's private Task outputs", () => {
    const sql = buildAuthorizedResourceSql({
      workspaceId: "ws-1",
      actor: member,
    });
    expect(sql.sql).toContain('fr."ownerUserId"');
    expect(sql.sql).toContain('t."ownerId"');
  });

  it("limits a shared bot to public Task outputs in its Project", () => {
    const sql = buildAuthorizedResourceSql({
      workspaceId: "ws-1",
      actor: { ...member, sokoBotScope: SCOPE },
    });
    expect(sql.sql).not.toContain('fr."ownerUserId"');
    expect(sql.sql).not.toContain('t."ownerId"');
    expect(sql.sql).toContain('t."projectId"');
    expect(sql.values).toEqual(expect.arrayContaining(["project-1", "ws-1"]));
  });

  it("leaves a workspace bot every Project", () => {
    const sql = buildAuthorizedResourceSql({
      workspaceId: "ws-1",
      actor: { ...member, sokoBotScope: { ...SCOPE, projectId: null } },
    });
    expect(sql.sql).not.toContain('t."projectId"');
    expect(sql.sql).not.toContain('t."ownerId"');
  });
});

describe("fileActorFingerprint with a shared scope", () => {
  it("keeps other actors' keys and separates a shared bot's", () => {
    const plain = fileActorFingerprint(member, "ws-1");
    expect(
      fileActorFingerprint({ ...member, sokoBotScope: null }, "ws-1"),
    ).toBe(plain);
    expect(
      fileActorFingerprint({ ...member, sokoBotScope: SCOPE }, "ws-1"),
    ).not.toBe(plain);
  });
});
