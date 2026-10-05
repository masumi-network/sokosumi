// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SignedOut } from "./signed-out";

// The mascot's separate suite covers WebGL. Keep asset downloads out of form tests.
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    async loadAsync() {
      throw new Error("No WebGL in form tests");
    }
  },
}));

async function signIn() {}
async function createAccount() {}

const actions = { signIn, createAccount };

describe("signed-out page", () => {
  it.each([
    ["Create account", "Sign in"],
    ["Sign in", "Create account"],
  ])(
    "%s stays busy until its action settles and can be retried, and %s waits",
    async (label, otherLabel) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const attempts: Array<() => void> = [];
      const action = vi.fn(
        () => new Promise<void>((resolve) => attempts.push(resolve)),
      );
      const otherAction = vi.fn(async () => {});
      const props =
        label === "Sign in"
          ? { signIn: action, createAccount: otherAction }
          : { signIn: otherAction, createAccount: action };
      try {
        await act(async () => {
          root.render(<SignedOut {...props} />);
        });
        const buttons = Array.from(container.querySelectorAll("button"));
        const button = buttons.find(
          (candidate) => candidate.textContent === label,
        );
        const other = buttons.find(
          (candidate) => candidate.textContent === otherLabel,
        );
        if (!button || !other) throw new Error("Missing a sign-in button");
        expect(button.disabled).toBe(false);
        expect(button.hasAttribute("aria-busy")).toBe(false);

        for (let attempt = 0; attempt < 2; attempt++) {
          await act(async () => button.click());
          expect(action).toHaveBeenCalledTimes(attempt + 1);
          expect(button.disabled).toBe(true);
          expect(button.getAttribute("aria-busy")).toBe("true");
          expect(button.textContent).toBe(label);
          expect(button.querySelector("[aria-hidden='true']")).not.toBeNull();
          expect(other.disabled).toBe(true);
          expect(other.hasAttribute("aria-busy")).toBe(false);
          expect(other.querySelector("[aria-hidden='true']")).toBeNull();

          await act(async () => button.click());
          await act(async () => other.click());
          expect(action).toHaveBeenCalledTimes(attempt + 1);
          expect(otherAction).not.toHaveBeenCalled();
          await act(async () => attempts[attempt]());
          expect(button.disabled).toBe(false);
          expect(button.hasAttribute("aria-busy")).toBe(false);
          expect(button.querySelector("[aria-hidden='true']")).toBeNull();
          expect(button.textContent).toBe(label);
          expect(other.disabled).toBe(false);
        }
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  );

  it("names the product and offers to create an account or sign in", () => {
    const html = renderToStaticMarkup(<SignedOut {...actions} />);

    expect(html).toContain("CMO.xyz runs your marketing end to end");
    expect(html).toMatch(
      /<form class="actions"><button class="button" type="submit"[^>]*><span class="button-label">Create account<\/span><\/button><button class="button button-secondary" type="submit"[^>]*><span class="button-label">Sign in<\/span><\/button><\/form>/,
    );
    expect(html).toContain(
      'CMO uses your <a href="https://sokosumi.com">Sokosumi</a> account.',
    );
    expect(html).not.toContain('role="alert"');
  });

  it("lists only the launch scope, not the newsletter", () => {
    const html = renderToStaticMarkup(<SignedOut {...actions} />);

    expect(html).toContain("<li>Google and Meta ads</li>");
    expect(html).not.toContain("ewsletter");
  });

  it("shows the mascot", () => {
    const html = renderToStaticMarkup(<SignedOut {...actions} />);

    expect(html).toContain('class="mascot hero-mascot"');
  });

  it("says plainly that nothing was shared when consent was declined", () => {
    const html = renderToStaticMarkup(
      <SignedOut error="access_denied" {...actions} />,
    );

    expect(html).toContain(
      '<p role="alert">You did not allow CMO. Nothing was shared.</p>',
    );
  });

  // One state cookie per browser: a second Sign in, in another tab or from
  // the link again, replaces the first flow's state, as does waiting too long.
  it.each(["state_mismatch", "state_invalid", "state_not_found"])(
    "says the sign in expired or was started again when its state fails (%s)",
    (error) => {
      const html = renderToStaticMarkup(
        <SignedOut error={error} {...actions} />,
      );

      expect(html).toContain(
        '<p role="alert">That sign in expired or was started again somewhere else. Press Sign in again.</p>',
      );
    },
  );

  it("says Sokosumi is not reachable when sign in could not start", () => {
    const html = renderToStaticMarkup(
      <SignedOut error="unavailable" {...actions} />,
    );

    expect(html).toContain(
      '<p role="alert">Sokosumi is not reachable right now. Try again in a minute.</p>',
    );
  });

  it("says the person was signed out when CMO ended the session", () => {
    const html = renderToStaticMarkup(
      <SignedOut error="signed_out" {...actions} />,
    );

    expect(html).toContain(
      '<p role="alert">You were signed out. Sign in again.</p>',
    );
  });

  it.each(["unable_to_get_user_info", "constructor"])(
    "asks to try again when sign in failed for another reason (%s)",
    (error) => {
      const html = renderToStaticMarkup(
        <SignedOut error={error} {...actions} />,
      );

      expect(html).toContain(
        '<p role="alert">Sign in did not finish. Try again.</p>',
      );
    },
  );
});
