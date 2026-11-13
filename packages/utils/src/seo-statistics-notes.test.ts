import { describe, expect, it } from "vitest";
import {
  readSeoStatisticsNote,
  SEO_STATISTICS_QUERY_ROWS_ANONYMIZED_NOTE,
  SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE,
  seoStatisticsKeywordRowsCutNote,
  seoStatisticsKeywordsLeftOutNote,
  seoStatisticsQueryRowsCutNote,
} from "./seo-statistics-notes";

describe("readSeoStatisticsNote", () => {
  it("reads the routine notes of every Search Console sync as routine", () => {
    for (const note of [
      SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE,
      SEO_STATISTICS_QUERY_ROWS_ANONYMIZED_NOTE,
    ])
      expect(readSeoStatisticsNote(note)).toEqual({ kind: "routine" });
  });

  it("reads the cut notes back with their row limit", () => {
    expect(readSeoStatisticsNote(seoStatisticsQueryRowsCutNote(500))).toEqual({
      kind: "flag",
    });
    expect(
      readSeoStatisticsNote(seoStatisticsKeywordRowsCutNote(25000)),
    ).toEqual({ kind: "gap", gap: "keywordRowsCut", count: 25000 });
  });

  it("reads back the keywords a sync left out, also when the note is cut", () => {
    const few = ["kw 24 (US)", "kw 25 (US)"];
    expect(
      readSeoStatisticsNote(seoStatisticsKeywordsLeftOutNote(few, 25, 3)),
    ).toEqual({ kind: "gap", gap: "keywordsLeftOut", names: few, count: 2 });
    // 300 names of 20 characters do not fit in one 2000-character note.
    const many = Array.from(
      { length: 300 },
      (_, index) => `keyword ${String(index).padStart(5, "0")} (US)`,
    );
    const cut = readSeoStatisticsNote(
      seoStatisticsKeywordsLeftOutNote(many, 25, 3),
    );
    expect(cut).toEqual(
      expect.objectContaining({ gap: "keywordsLeftOut", count: 300 }),
    );
    const names = cut?.kind === "gap" ? (cut.names ?? []) : [];
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual(many.slice(0, names.length));
    // Not even the first name fits.
    expect(
      readSeoStatisticsNote(
        seoStatisticsKeywordsLeftOutNote(["x".repeat(2000)], 25, 3),
      ),
    ).toEqual({ kind: "gap", gap: "keywordsLeftOut", names: [], count: 1 });
  });

  it("knows no other note", () => {
    expect(readSeoStatisticsNote("A note from another writer.")).toBeNull();
    expect(
      readSeoStatisticsNote(`${seoStatisticsQueryRowsCutNote(500)} More.`),
    ).toBeNull();
  });
});
