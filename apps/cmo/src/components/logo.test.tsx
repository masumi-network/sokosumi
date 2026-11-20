import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type Lockup, Logo } from "./logo";

const LOGO_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/logo",
);

/** The brand guide's approved background for each file in public/logo. */
const ON_LIGHT: Record<Lockup, string> = {
  stacked: "stacked-text-black",
  primary: "mascot-top-outline-black",
  framed: "framed-black",
  block: "block-black",
};
const ON_DARK: Record<Lockup, string> = {
  stacked: "stacked-text-white",
  primary: "mascot-top-white",
  framed: "framed-white",
  block: "block-white",
};

describe("logo", () => {
  it("is the stacked lockup by default, named once for screen readers", () => {
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

  it.each(Object.keys(ON_LIGHT) as Lockup[])(
    "shows the %s lockup approved on white on a light page and on black on a dark one",
    (lockup) => {
      const html = renderToStaticMarkup(
        <Logo lockup={lockup} className="hero-logo" />,
      );

      expect(html).toContain('class="logo hero-logo"');
      expect(html).toContain(
        `class="logo-on-light" src="/logo/cmo-xyz-lockup-${ON_LIGHT[lockup]}.svg"`,
      );
      expect(html).toContain(
        `class="logo-on-dark" src="/logo/cmo-xyz-lockup-${ON_DARK[lockup]}.svg"`,
      );
    },
  );

  it("ships every lockup file it names", () => {
    const files = readdirSync(LOGO_DIR);
    for (const name of [
      ...Object.values(ON_LIGHT),
      ...Object.values(ON_DARK),
    ]) {
      expect(files).toContain(`cmo-xyz-lockup-${name}.svg`);
    }
  });
});
