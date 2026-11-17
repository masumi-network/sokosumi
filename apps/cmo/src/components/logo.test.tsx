import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Logo } from "./logo";

describe("logo", () => {
  it("is the cursor-head mark beside the wordmark, named once for screen readers", () => {
    const html = renderToStaticMarkup(<Logo />);

    expect(html).toContain(
      '<span aria-label="CMO.xyz" class="logo" role="img">',
    );
    expect(html).toContain('<img alt="" src="/logo.svg"/>');
    expect(html).toContain('<span aria-hidden="true">CMO.XYZ</span>');
  });
});
