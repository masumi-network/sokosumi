import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CmoWordmark } from "./cmo-wordmark";

describe("CmoWordmark", () => {
  it("shows the approved wordmark file for each theme, named for screen readers", () => {
    const html = renderToStaticMarkup(<CmoWordmark />);

    expect(html.match(/alt="CMO\.xyz"/g)).toHaveLength(2);
    expect(html).toMatch(/dark:hidden[^>]*cmo-xyz-dela-black\.svg/);
    expect(html).toMatch(/hidden[^>]*dark:block[^>]*cmo-xyz-dela-white\.svg/);
  });
});
