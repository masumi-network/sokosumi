import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CmoWordmark } from "./cmo-wordmark";

describe("CmoWordmark", () => {
  it("draws CMO.xyz's wordmark in the text colour, named for screen readers", () => {
    const html = renderToStaticMarkup(<CmoWordmark />);

    expect(html).toContain('aria-label="CMO.xyz"');
    expect(html).toContain('role="img"');
    expect(html).toContain('fill="currentColor"');
    expect(html.match(/<path /g)).toHaveLength(14);
  });
});
