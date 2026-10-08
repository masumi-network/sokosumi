import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Logo } from "./logo";

describe("logo", () => {
  it("reads as the name, with the public pointer mark as decoration", () => {
    const html = renderToStaticMarkup(<Logo />);

    expect(html).toContain('<img alt="" class="logo-mark"');
    expect(html).toContain('src="/logo.svg"');
    expect(html).toMatch(/\/>CMO\.xyz<\/span>$/);
  });
});
