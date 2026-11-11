// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SignInProblem } from "./sign-in-problem";

// The mascot's separate suite covers WebGL. Keep asset downloads out of form tests.
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    async loadAsync() {
      throw new Error("No WebGL in form tests");
    }
  },
}));

async function signIn() {}

const alertFor = (error: string) =>
  renderToStaticMarkup(<SignInProblem error={error} signIn={signIn} />);

describe("sign-in problem page", () => {
  it("Try again stays busy until sign in starts and can be retried", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const attempts: Array<() => void> = [];
    const action = vi.fn(
      () => new Promise<void>((resolve) => attempts.push(resolve)),
    );
    try {
      await act(async () => {
        root.render(<SignInProblem error="access_denied" signIn={action} />);
      });
      const button = container.querySelector("button");
      if (!button) throw new Error("Missing Try again");
      expect(button.textContent).toBe("Try again");

      for (let attempt = 0; attempt < 2; attempt++) {
        await act(async () => button.click());
        expect(action).toHaveBeenCalledTimes(attempt + 1);
        expect(button.getAttribute("aria-busy")).toBe("true");
        await act(async () => button.click());
        expect(action).toHaveBeenCalledTimes(attempt + 1);
        await act(async () => attempts[attempt]());
        expect(button.hasAttribute("aria-busy")).toBe(false);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("says why sign in stopped, with the mascot", () => {
    const html = alertFor("access_denied");

    expect(html).toContain("<h1>Sign in did not finish.</h1>");
    expect(html).toContain(
      '<p role="alert">You did not allow CMO. Nothing was shared.</p>',
    );
    expect(html).toContain('class="mascot hero-mascot"');
  });

  // One state cookie per browser: a second Sign in, in another tab or from
  // the link again, replaces the first flow's state, as does waiting too long.
  it.each(["state_mismatch", "state_invalid", "state_not_found"])(
    "says the sign in expired or was started again when its state fails (%s)",
    (error) => {
      expect(alertFor(error)).toContain(
        '<p role="alert">That sign in expired or was started again somewhere else. Try again.</p>',
      );
    },
  );

  it("says Sokosumi is not reachable when sign in could not start", () => {
    expect(alertFor("unavailable")).toContain(
      '<p role="alert">Sokosumi is not reachable right now. Try again in a minute.</p>',
    );
  });

  it("says the person was signed out when CMO ended the session", () => {
    const html = alertFor("signed_out");
    expect(html).toContain("<h1>You were signed out.</h1>");
    expect(html).toContain(
      '<p role="alert">Your session ended. Sign in to pick up where you left off.</p>',
    );
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Sign in/);
    expect(html).not.toContain("did not finish");
  });

  it.each(["unable_to_get_user_info", "constructor"])(
    "asks to try again when sign in failed for another reason (%s)",
    (error) => {
      expect(alertFor(error)).toContain(
        '<p role="alert">Sign in did not finish. Try again.</p>',
      );
    },
  );

  it("says the website typed before sign in is kept for the retry", () => {
    const html = renderToStaticMarkup(
      <SignInProblem error="access_denied" signIn={signIn} website="acme.io" />,
    );
    expect(html).toContain("I kept acme.io. You won&#x27;t type it again.");
    expect(alertFor("access_denied")).not.toContain("I kept");
  });
});
