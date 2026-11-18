import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Logo } from "./logo";

describe("logo", () => {
  it("is the approved lockup for each theme, named once for screen readers", () => {
    const html = renderToStaticMarkup(<Logo />);

    expect(html).toContain(
      '<span aria-label="CMO.xyz" class="logo" role="img">',
    );
    expect(html).toContain(
      '<img alt="" class="logo-on-light" src="/logo/cmo-xyz-lockup-stacked-text-black.svg"/>',
    );
    expect(html).toContain(
      '<img alt="" class="logo-on-dark" src="/logo/cmo-xyz-lockup-stacked-text-white.svg"/>',
    );
  });
});
