import { describe, expect, it } from "vitest";
import { parsePublicSeoArtifact } from "@/helpers/project-seo-report";
import { focusedRankingsReport } from "@/test-fixtures/project-seo";
import { seoRankPointKey, seoRankPoints } from "./project-seo-rank-points";

const base = focusedRankingsReport();
const row = base.keywords[0];
function payload(keywords: Record<string, unknown>[], kind = base.kind) {
  return parsePublicSeoArtifact({
    ...base,
    kind,
    keywords: keywords.map((item) => ({ ...row, ...item })),
  });
}

describe("rank points of a result", () => {
  it("gives one point per read with an answer, under the key of its workspace row", () => {
    const data = payload([
      { position: 4, positionStatus: "ranked", device: "desktop" },
      {
        position: null,
        positionStatus: "not_in_range",
        checkedResults: 100,
        device: "mobile",
      },
    ]);
    expect(
      seoRankPoints("observation", data).map((point) => [
        point.key,
        point.position,
        point.positionStatus,
        point.checkedResults,
        point.device,
      ]),
    ).toEqual([
      [
        seoRankPointKey(
          // A workspace row writes the same keyword in another case and form.
          { ...row, keyword: row.keyword.toUpperCase(), device: "desktop" },
          data.countryCode,
          data.languageCode,
        ),
        4,
        "ranked",
        row.checkedResults,
        "desktop",
      ],
      [
        seoRankPointKey(
          { ...row, device: "mobile" },
          data.countryCode,
          data.languageCode,
        ),
        null,
        "not_in_range",
        100,
        "mobile",
      ],
    ]);
  });

  it("gives no point for a failed read, and a later row of the same keyword does not take its place", () => {
    const data = payload([
      { position: null, positionStatus: "unavailable" },
      { position: 2, positionStatus: "ranked" },
    ]);
    expect(seoRankPoints("observation", data)).toEqual([]);
  });

  it("gives no point for a result kind that reads no position", () => {
    expect(
      seoRankPoints(
        "observation",
        payload([{ position: 1, positionStatus: "ranked" }], "page_check"),
      ),
    ).toEqual([]);
  });
});
