import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignedOut } from "./signed-out";

async function signIn() {}
async function createAccount() {}

const actions = { signIn, createAccount };

describe("signed-out page", () => {
  it("names the product and offers to create an account or sign in", () => {
    const html = renderToStaticMarkup(<SignedOut {...actions} />);

    expect(html).toContain("<h1>CMO.XYZ</h1>");
    expect(html).toContain('<button type="submit">Create account</button>');
    expect(html).toContain('<button type="submit">Sign in</button>');
    expect(html.indexOf("Create account")).toBeLessThan(
      html.indexOf("Sign in</button>"),
    );
    expect(html).toContain("CMO uses your Sokosumi account.");
    expect(html).not.toContain('role="alert"');
  });

  it("says plainly that nothing was shared when consent was declined", () => {
    const html = renderToStaticMarkup(
      <SignedOut error="access_denied" {...actions} />,
    );

    expect(html).toContain(
      '<p role="alert">You did not allow CMO. Nothing was shared.</p>',
    );
  });

  it("asks to try again when sign in failed for another reason", () => {
    const html = renderToStaticMarkup(
      <SignedOut error="unable_to_get_user_info" {...actions} />,
    );

    expect(html).toContain(
      '<p role="alert">Sign in did not finish. Try again.</p>',
    );
  });
});
