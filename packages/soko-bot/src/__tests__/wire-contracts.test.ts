import { describe, expect, it } from "vitest";
import type { SokoBotContextPacket } from "../runtime.js";
import { sokoBotContextPacketSchema } from "../wire-contracts.js";

const validPacket = {
  schemaVersion: 1,
  generatedAt: "2026-08-18T12:00:00.000Z",
  hash: "context-hash",
  trigger: {
    source: "CHAT",
    route: "DIRECT_RESPONSE",
    confidence: 0.9,
    requestedOutcome: "Hello",
    askedBy: { kind: "OWNER", name: "Ada", trust: "untrusted-data" },
  },
  actor: { id: "user-1", extra: { nested: true } },
  workspace: { id: "ws-1" },
  projects: [{ id: "project-1", briefing: "Ship" }],
  tasks: [],
  coworkers: [],
  agents: [],
  jobs: [],
  pendingDecisions: [],
  recentTurns: [],
  memory: { version: 1, hash: "memory-hash", markdown: "# Soko Bot memory" },
  counts: { tasks: 0 },
  omissions: { tasks: 0 },
} satisfies SokoBotContextPacket;

describe("sokoBotContextPacketSchema", () => {
  it("accepts a packet that matches the exported TS contract", () => {
    const parsed = sokoBotContextPacketSchema.parse(validPacket);
    const trigger: SokoBotContextPacket["trigger"] = parsed.trigger;

    expect(trigger).toEqual(validPacket.trigger);
    expect(parsed.actor).toEqual(validPacket.actor);
    expect(parsed.projects).toEqual(validPacket.projects);
  });

  it("still allows open actor, workspace, and collection records", () => {
    expect(
      sokoBotContextPacketSchema.parse({
        ...validPacket,
        actor: { any: "shape", count: 2, flag: false },
        workspace: { plan: null, tags: ["a"] },
        tasks: [{ id: "task-1", unknownField: { ok: true } }],
      }),
    ).toMatchObject({
      actor: { any: "shape", count: 2, flag: false },
      workspace: { plan: null, tags: ["a"] },
      tasks: [{ id: "task-1", unknownField: { ok: true } }],
    });
  });

  it("rejects a trigger that is only a JSON object", () => {
    expect(
      sokoBotContextPacketSchema.safeParse({
        ...validPacket,
        trigger: { source: "CHAT" },
      }).success,
    ).toBe(false);
  });

  it("rejects trigger source, route, askedBy kind, and trust outside the TS unions", () => {
    expect(
      sokoBotContextPacketSchema.safeParse({
        ...validPacket,
        trigger: { ...validPacket.trigger, source: "EMAIL" },
      }).success,
    ).toBe(false);
    expect(
      sokoBotContextPacketSchema.safeParse({
        ...validPacket,
        trigger: { ...validPacket.trigger, route: "SUMMARIZE" },
      }).success,
    ).toBe(false);
    expect(
      sokoBotContextPacketSchema.safeParse({
        ...validPacket,
        trigger: {
          ...validPacket.trigger,
          askedBy: { ...validPacket.trigger.askedBy, kind: "STRANGER" },
        },
      }).success,
    ).toBe(false);
    expect(
      sokoBotContextPacketSchema.safeParse({
        ...validPacket,
        trigger: {
          ...validPacket.trigger,
          askedBy: { ...validPacket.trigger.askedBy, trust: "trusted" },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts a nameless assistant asker", () => {
    expect(
      sokoBotContextPacketSchema.parse({
        ...validPacket,
        trigger: {
          ...validPacket.trigger,
          source: "EVENT",
          askedBy: {
            kind: "ASSISTANT",
            name: null,
            trust: "untrusted-data",
          },
        },
      }).trigger.askedBy,
    ).toEqual({
      kind: "ASSISTANT",
      name: null,
      trust: "untrusted-data",
    });
  });
});
