import { describe, expect, it } from "vitest";
import {
  decideMerge,
  type MergeCandidateView,
  mergeWinner,
  normalizePersonName,
} from "./merge-rules";

function view(
  id: string,
  name: string,
  channels: { type: string; value: string }[],
  organization: string | null = null,
  createdAt = "2026-10-01T00:00:00Z",
): MergeCandidateView {
  return { id, name, organization, channels, createdAt: new Date(createdAt) };
}

describe("normalizePersonName", () => {
  it("ignores case, accents, titles and punctuation", () => {
    expect(normalizePersonName("Dr. José  Müller")).toBe("jose muller");
    expect(normalizePersonName("Jose MULLER")).toBe("jose muller");
  });
});

describe("decideMerge", () => {
  const nina = view("a", "Nina Keller", [
    { type: "EMAIL", value: "nina@acme.com" },
    { type: "PHONE", value: "+41791234567" },
  ]);

  it("merges on its own only with the same name, company domain and a shared phone or profile", () => {
    expect(
      decideMerge(
        nina,
        view("b", "nina keller", [
          { type: "EMAIL", value: "n.keller@acme.com" },
          { type: "PHONE", value: "0791234567" },
        ]),
      ),
    ).toBe("auto");
    expect(
      decideMerge(
        view("a", "Tom Berger", [
          { type: "EMAIL", value: "tom@acme.com" },
          { type: "LINKEDIN", value: "https://www.linkedin.com/in/tomberger" },
        ]),
        view("b", "Tom Berger", [
          { type: "EMAIL", value: "t.berger@acme.com" },
          { type: "WEBSITE", value: "https://linkedin.com/in/tomberger" },
        ]),
      ),
    ).toBe("auto");
  });

  it("only suggests the same name at the same company without a shared channel", () => {
    expect(
      decideMerge(
        nina,
        view("b", "Nina Keller", [{ type: "EMAIL", value: "nk@acme.com" }]),
      ),
    ).toBe("suggest");
    expect(
      decideMerge(
        view("a", "Nina Keller", [], "Acme AG"),
        view("b", "Nina Keller", [], "acme ag"),
      ),
    ).toBe("suggest");
  });

  it("never merges a one-word name on its own", () => {
    expect(
      decideMerge(
        view("a", "Nina", [
          { type: "EMAIL", value: "nina@acme.com" },
          { type: "PHONE", value: "+41791234567" },
        ]),
        view("b", "Nina", [
          { type: "EMAIL", value: "n@acme.com" },
          { type: "PHONE", value: "+41791234567" },
        ]),
      ),
    ).toBe("suggest");
  });

  it("suggests a nickname with the same surname and initial at the same company", () => {
    expect(
      decideMerge(
        view("a", "Tom Berger", [{ type: "EMAIL", value: "tom@acme.com" }]),
        view("b", "Thomas Berger", [
          { type: "EMAIL", value: "t.berger@acme.com" },
        ]),
      ),
    ).toBe("suggest");
  });

  it("keeps namesakes at different or freemail domains apart", () => {
    expect(
      decideMerge(
        view("a", "Max Muster", [{ type: "EMAIL", value: "max@gmail.com" }]),
        view("b", "Max Muster", [{ type: "EMAIL", value: "mm@gmail.com" }]),
      ),
    ).toBeNull();
    expect(
      decideMerge(
        view("a", "Tom Berger", [{ type: "EMAIL", value: "tom@acme.com" }]),
        view("b", "Thomas Berger", [{ type: "EMAIL", value: "tb@other.com" }]),
      ),
    ).toBeNull();
    expect(decideMerge(nina, nina)).toBeNull();
  });
});

describe("mergeWinner", () => {
  it("keeps the older contact", () => {
    const older = view("a", "A", [], null, "2026-01-01T00:00:00Z");
    const newer = view("b", "A", [], null, "2026-05-01T00:00:00Z");
    expect(mergeWinner(newer, older)).toEqual({ winner: older, loser: newer });
  });
});
