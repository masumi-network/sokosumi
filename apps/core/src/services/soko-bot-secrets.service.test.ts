import { describe, expect, it } from "vitest";

import { sandboxShellNote } from "./soko-bot-secrets.service";

describe("the shell note a sandbox turn gets", () => {
  it("names the keys and commands, never a key's value", () => {
    const note = sandboxShellNote({
      setupCommands: ["npm install -g vercel"],
      env: { VERCEL_TOKEN: "vercel_tok_8d2f91c4" },
    });
    expect(note).toContain('"npm install -g vercel"');
    expect(note).toContain("VERCEL_TOKEN");
    expect(note).not.toContain("vercel_tok_8d2f91c4");
  });

  it("says nothing when the owner saved nothing for the shell", () => {
    expect(sandboxShellNote({ setupCommands: [], env: {} })).toBeNull();
  });
});
