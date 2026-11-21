import { describe, expect, it } from "vitest";
import { capabilitiesForClassification } from "../policy.js";
import { applyVersionCapabilities, getSokoBotVersion } from "./index.js";

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
});
