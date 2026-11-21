import { describe, expect, it } from "vitest";
import { seo } from "../app/design-system/app/fixtures";
import { changeText, positionChangeText, seoSteps } from "./seo-next";

describe("seoSteps", () => {
  it("puts open page changes before articles, and connecting first when Search Console is off", () => {
    const kinds = seoSteps(seo).map((step) => step.kind);
    expect(kinds[0]).toBe("change");
    expect(kinds.indexOf("article")).toBeGreaterThan(
      kinds.lastIndexOf("change"),
    );
    const off = {
      ...seo,
      searchConsole: { ...seo.searchConsole, status: "not_connected" as const },
    };
    expect(seoSteps(off)[0]).toEqual({ kind: "connect" });
  });
});

describe("trend words", () => {
  it("says the change on the 28 days before", () => {
    expect(changeText(412, 368)).toBe("+12% on the 28 days before");
    expect(changeText(300, 400)).toBe("−25% on the 28 days before");
    expect(changeText(5, 0)).toBeNull();
  });

  it("calls a lower position up", () => {
    expect(positionChangeText(14.6, 15.9)).toBe("up from 15.9");
    expect(positionChangeText(17, 12)).toBe("down from 12.0");
    expect(positionChangeText(null, 12)).toBeNull();
  });
});
