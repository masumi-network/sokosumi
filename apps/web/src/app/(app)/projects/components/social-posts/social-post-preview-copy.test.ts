import { describe, expect, it } from "vitest";
import de from "@/messages/de.json";

describe("German social preview copy", () => {
  it("calls the empty composer preview a Beitrag", () => {
    expect(de.App.Projects.SocialPosts.composer.previewEmpty).toBe(
      "Hier erscheint dein Beitrag, während du schreibst.",
    );
  });
});
