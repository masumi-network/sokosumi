import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Logo } from "./logo";

describe("logo", () => {
  it("is the wordmark, named for screen readers and drawn in the text colour", () => {
    const html = renderToStaticMarkup(<Logo />);

    expect(html).toMatch(/^<svg[^>]*aria-label="CMO.xyz"/);
    expect(html).toContain('role="img"');
    expect(html).toContain('fill="currentColor"');
    expect(html.match(/<path /g)).toHaveLength(14);
  });
});
