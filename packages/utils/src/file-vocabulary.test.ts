import { describe, expect, it } from "vitest";

import {
  checkFileLabelName,
  countGraphemes,
  normalizeFileLabelName,
  normalizeFileResourceName,
} from "./file-vocabulary.js";

describe("normalizeFileLabelName", () => {
  it("folds case so one workspace cannot hold Aurora and aurora", () => {
    expect(normalizeFileLabelName("Aurora")).toBe(
      normalizeFileLabelName("aurora"),
    );
  });

  it("collapses whitespace and trims", () => {
    expect(normalizeFileLabelName("  audience   research ")).toBe(
      "audience research",
    );
  });

  it("normalizes to NFC so a composed and a decomposed accent match", () => {
    expect(normalizeFileLabelName("Ubersicht́")).toBe(
      normalizeFileLabelName("Ubersicht́".normalize("NFC")),
    );
  });
});

describe("countGraphemes", () => {
  it("counts an emoji with a modifier once", () => {
    expect(countGraphemes("👩🏽‍🚀")).toBe(1);
  });

  it("counts a combining accent with its base once", () => {
    expect(countGraphemes("é")).toBe(1);
  });
});

describe("checkFileLabelName", () => {
  it("accepts an ordinary tag and keeps its capitalization", () => {
    const check = checkFileLabelName(" Aurora Launch ");
    expect(check.valid).toBe(true);
    expect(check.displayName).toBe("Aurora Launch");
    expect(check.normalizedName).toBe("aurora launch");
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(checkFileLabelName("   ").problem).toBe("empty");
  });

  it("rejects markup rather than storing something to escape later", () => {
    expect(checkFileLabelName("<img src=x>").problem).toBe("markup");
  });

  it("rejects control characters", () => {
    expect(checkFileLabelName("tagname").problem).toBe("control-characters");
  });

  it("measures the limit in graphemes, not code units", () => {
    const fortyEmoji = "👩🏽‍🚀".repeat(40);
    expect(checkFileLabelName(fortyEmoji).valid).toBe(true);
    expect(checkFileLabelName(`${fortyEmoji}👩🏽‍🚀`).problem).toBe("too-long");
  });
});

describe("normalizeFileResourceName", () => {
  it("matches the same filename typed with different case and spacing", () => {
    expect(normalizeFileResourceName("Aurora-Research.PDF")).toBe(
      normalizeFileResourceName("aurora-research.pdf"),
    );
    expect(normalizeFileResourceName("Q3  report.docx")).toBe("q3 report.docx");
  });
});
