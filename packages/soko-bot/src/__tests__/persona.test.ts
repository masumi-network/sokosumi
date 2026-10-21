import { describe, expect, it } from "vitest";

import {
  composeSokoBotIntroduction,
  composeSokoBotPersona,
} from "../persona.js";

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

describe("shared Soko Bot persona", () => {
  it("names no owner and keeps private matters out of team-readable text", () => {
    const persona = composeSokoBotPersona({
      name: "Atlas",
      ownerName: "Patrick Tobler",
      shared: true,
    });
    expect(persona).toContain("shared team assistant");
    expect(persona).toContain("personal finances and salary");
    expect(persona).not.toContain("Patrick");
    expect(persona).not.toContain("your owner");
  });

  it("introduces itself to the team, not to one person", () => {
    const intro = composeSokoBotIntroduction({
      name: "Atlas",
      ownerName: "Patrick Tobler",
      shared: true,
    });
    expect(intro).toContain("a shared assistant for this team");
    expect(intro).not.toContain("Patrick");
    expect(intro).not.toContain("your personal assistant");
  });

  it("keeps the personal introduction unchanged", () => {
    expect(
      composeSokoBotIntroduction({ name: "Atlas", ownerName: "Ana Lima" }),
    ).toContain("Hi Ana! I'm **Atlas**, your personal assistant");
  });
});
