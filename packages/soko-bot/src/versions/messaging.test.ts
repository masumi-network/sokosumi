import { describe, expect, it } from "vitest";
import { capabilitiesForClassification } from "../policy.js";
import {
  applyVersionCapabilities,
  getSokoBotSkill,
  getSokoBotVersion,
  sokoBotToolDescription,
  versionShowsResultCards,
} from "./index.js";

const chat = capabilitiesForClassification({
  route: "MANAGE_WORK",
  writeScope: "CHAT",
} as never);

describe("messaging tools by version", () => {
  it("gives v35 send_message and list_recipients instead of the three older tools", () => {
    const tools = applyVersionCapabilities(getSokoBotVersion("v35"), chat);
    expect(tools).toEqual(expect.arrayContaining(["send_message", "wait_for"]));
    for (const old of ["post_chat", "open_direct_chat", "ask_coworker"])
      expect(tools).not.toContain(old);
  });

  it("keeps the older tools, and nothing new, on earlier versions", () => {
    const tools = applyVersionCapabilities(getSokoBotVersion("v33"), chat);
    expect(tools).toEqual(
      expect.arrayContaining(["post_chat", "open_direct_chat", "ask_coworker"]),
    );
    expect(tools).not.toContain("send_message");
    expect(tools).not.toContain("list_recipients");
  });

  it("teaches v35 conversations instead of polling a room", () => {
    const v35 = getSokoBotVersion("v35");
    expect(v35.skills).toContain("conversations");
    expect(v35.skills).toContain("coworkers-and-agents-messaging");
    expect(v35.skills).not.toContain("coworkers-and-agents");
    expect(v35.systemPrompt).toContain("`send_message` them by name");
  });

  it("builds v36 on v35's messaging and v34's stronger model", () => {
    const v36 = getSokoBotVersion("v36");
    expect(v36.messaging).toBe("send_message");
    expect(v36.strongModel).toBe(getSokoBotVersion("v34").strongModel);
    expect(v36.skills).toContain("conversations-handoffs");
    expect(v36.skills).not.toContain("conversations");
  });

  it("uses send_message (never post_chat/ask_coworker) in v35+ result-cards skill and tool descriptions", () => {
    const v34 = getSokoBotVersion("v34");
    const v36 = getSokoBotVersion("v36");
    expect(v36.skills).toContain("result-cards-messaging");
    expect(v36.skills).not.toContain("result-cards");
    expect(versionShowsResultCards(v36)).toBe(true);
    const skillText = getSokoBotSkill("result-cards-messaging").content;
    expect(skillText).toContain("`send_message` with `resultReferences`");
    expect(skillText).not.toContain("post_chat");
    expect(skillText).toContain("have no result card");

    for (const cap of [
      "create_schedule",
      "preview_result",
      "wait_for",
    ] as const) {
      const descV36 = sokoBotToolDescription(cap, v36);
      expect(descV36).not.toContain("post_chat");
      expect(descV36).not.toContain("ask_coworker");
      expect(descV36).toContain("send_message");
      // Older non-send_message versions remain unchanged.
      expect(sokoBotToolDescription(cap, v34)).toContain("post_chat");
    }
  });
});
