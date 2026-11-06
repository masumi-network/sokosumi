import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { cmoOverview } from "../test-fixtures/cmo";
import { BusinessMark } from "./business-mark";

const markWith = (colors: string[]) =>
  renderToStaticMarkup(
    <BusinessMark
      overview={cmoOverview({
        projectLogo: null,
        brandVisual: {
          ...(cmoOverview().brandVisual as NonNullable<
            CmoOverview["brandVisual"]
          >),
          logoUrl: null,
          colors,
        },
      })}
    />,
  );

describe("BusinessMark letter", () => {
  it("writes the initial in white on a dark brand colour", () => {
    expect(markWith(["#0A66C2"])).toContain("color:var(--mark-white)");
  });

  it("writes the initial in black on a light brand colour", () => {
    expect(markWith(["#F7B267"])).toContain("color:var(--mark-black)");
  });
});
