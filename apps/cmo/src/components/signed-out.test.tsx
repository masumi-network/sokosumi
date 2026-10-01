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
  it.each(["Create account", "Sign in"])(
    "%s stays busy until its action settles and can be retried",
    async (label) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const attempts: Array<() => void> = [];
      const action = vi.fn(
        () => new Promise<void>((resolve) => attempts.push(resolve)),
      );
      try {
        await act(async () => {
          root.render(<SignedOut signIn={action} createAccount={action} />);
        });
        const button = Array.from(container.querySelectorAll("button")).find(
          (candidate) => candidate.textContent === label,
        );
        if (!button) throw new Error(`Missing ${label} button`);
        expect(button.disabled).toBe(false);
        expect(button.hasAttribute("aria-busy")).toBe(false);

        for (let attempt = 0; attempt < 2; attempt++) {
          await act(async () => button.click());
          expect(action).toHaveBeenCalledTimes(attempt + 1);
          expect(button.disabled).toBe(true);
          expect(button.getAttribute("aria-busy")).toBe("true");
          expect(button.textContent).toBe(label);
          expect(button.querySelector("[aria-hidden='true']")).not.toBeNull();

          await act(async () => button.click());
          expect(action).toHaveBeenCalledTimes(attempt + 1);
          await act(async () => attempts[attempt]());
          expect(button.disabled).toBe(false);
          expect(button.hasAttribute("aria-busy")).toBe(false);
          expect(button.querySelector("[aria-hidden='true']")).toBeNull();
          expect(button.textContent).toBe(label);
        }
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  );

  it("names the product and offers to create an account or sign in", () => {
    const html = renderToStaticMarkup(<SignedOut {...actions} />);

    expect(html).toContain("CMO.XYZ runs your marketing end to end");
    expect(html).toContain(
      '<button class="button" type="submit"><span class="button-label">Create account</span></button>',
    );
    expect(html).toContain(
      '<button class="button button-secondary" type="submit"><span class="button-label">Sign in</span></button>',
    );
    expect(html.indexOf("Create account")).toBeLessThan(
      html.indexOf("Sign in</span>"),
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

  it("says the sign in took too long when its state is gone", () => {
    const html = renderToStaticMarkup(
      <SignedOut error="state_mismatch" {...actions} />,
    );

    expect(html).toContain(
      '<p role="alert">That sign in took too long. Press Sign in again.</p>',
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
