import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SignedOutPage from "./page";

describe("signed-out page", () => {
  const html = renderToStaticMarkup(<SignedOutPage />);

  it("names the product", () => {
    expect(html).toContain("<h1>CMO.XYZ</h1>");
  });

  it("shows an inert Sign in with Sokosumi button", () => {
    expect(html).toMatch(
      /<button type="button" disabled="">Sign in with Sokosumi<\/button>/,
    );
  });
});
