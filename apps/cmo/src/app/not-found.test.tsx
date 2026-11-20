import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import NotFound from "./not-found";

it("says the page is not here, beside the framed lockup, with a way home", () => {
  const html = renderToStaticMarkup(<NotFound />);

  expect(html).toContain("<h1>This page is not here.</h1>");
  expect(html).toContain('<a class="button" href="/">Go home</a>');
  expect(html).toContain('src="/logo/cmo-xyz-lockup-framed-black.svg"');
  expect(html).toContain('src="/logo/cmo-xyz-lockup-framed-white.svg"');
});
