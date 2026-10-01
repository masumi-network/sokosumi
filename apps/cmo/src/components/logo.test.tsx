import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Logo } from "./logo";

describe("logo", () => {
  it("reads as the name, with the pointer mark hidden from assistive tech", () => {
    const html = renderToStaticMarkup(<Logo />);

    expect(html).toMatch(/<svg aria-hidden="true" class="logo-mark"/);
    expect(html).toMatch(/<\/svg>CMO\.XYZ<\/span>$/);
  });
});
