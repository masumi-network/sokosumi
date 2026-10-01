import { describe, expect, it } from "vitest";

import { composeSokoBotPersona } from "../persona.js";

describe("composeSokoBotPersona", () => {
  it("tells the bot what to share with teammates and what to keep private", () => {
    const persona = composeSokoBotPersona({
      name: "Joseph",
      ownerName: "Patrick Tobler",
    });
    expect(persona).toContain("availability and free/busy times");
    expect(persona).toContain("personal finances and salary");
    expect(persona).toContain("suggest they ask Patrick");
    expect(persona).toContain("unless Patrick explicitly asks");
  });
});
