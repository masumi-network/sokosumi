import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  skillFindMany: vi.fn(),
  turnFindUnique: vi.fn(),
  resolveMessageSkills: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessageSkill: { findMany: db.skillFindMany },
    sokoBotTurn: { findUnique: db.turnFindUnique },
  },
}));

vi.mock("@/services/skill-catalog.service", () => ({
  resolveMessageSkills: db.resolveMessageSkills,
}));

import { SokoBotSkillError } from "@/services/soko-bot-skills.service";

import {
  resolveAttachedSkills,
  skillsPromptBlock,
  withMessageSkills,
  withTurnSkills,
} from "./chat-message-skills.service";

const skill = { skillId: "a/b/grill-me", name: "grill-me", content: "Ask." };

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
});

describe("skillsPromptBlock", () => {
  it("is empty without skills", () => {
    expect(skillsPromptBlock([])).toBe("");
  });

  it("delimits each skill and scopes it to this request", () => {
    const block = skillsPromptBlock([skill]);

    expect(block).toContain("SKILLS ATTACHED TO THIS MESSAGE");
    expect(block).toContain("Follow them for this request only");
    expect(block).toContain(
      '<skill name="grill-me" id="a/b/grill-me">\nAsk.\n</skill>',
    );
  });
});

describe("withMessageSkills", () => {
  it("appends the message's skills after the text", async () => {
    db.skillFindMany.mockResolvedValue([skill]);

    const text = await withMessageSkills("msg-1", "Plan the launch");

    expect(text.startsWith("Plan the launch\n\nSKILLS ATTACHED")).toBe(true);
    expect(db.skillFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { messageId: "msg-1" },
        orderBy: { position: "asc" },
      }),
    );
  });

  it("leaves a message without skills unchanged", async () => {
    db.skillFindMany.mockResolvedValue([]);

    expect(await withMessageSkills("msg-1", "Hi")).toBe("Hi");
  });
});

describe("withTurnSkills", () => {
  it("reads the skills of the chat message that started the turn", async () => {
    db.turnFindUnique.mockResolvedValue({
      chatMention: { messageId: "msg-1" },
    });
    db.skillFindMany.mockResolvedValue([skill]);

    expect(await withTurnSkills("turn-1", "Hi")).toContain("<skill");
  });

  it("leaves turns that did not start in chat unchanged", async () => {
    db.turnFindUnique.mockResolvedValue({ chatMention: null });

    expect(await withTurnSkills("turn-1", "Stand-up")).toBe("Stand-up");
    expect(db.skillFindMany).not.toHaveBeenCalled();
  });
});

describe("resolveAttachedSkills", () => {
  it("does nothing without skill ids", async () => {
    expect(await resolveAttachedSkills(undefined)).toEqual([]);
    expect(db.resolveMessageSkills).not.toHaveBeenCalled();
  });

  it("turns a skill error into a 400", async () => {
    db.resolveMessageSkills.mockRejectedValue(
      new SokoBotSkillError('Skill "x" not found'),
    );

    await expect(resolveAttachedSkills(["a/b/x"])).rejects.toMatchObject({
      status: 400,
      message: 'Could not attach the skill: Skill "x" not found',
    });
  });
});
