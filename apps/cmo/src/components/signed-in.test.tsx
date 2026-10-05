// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { SignedIn } from "./signed-in";

// The mascot's separate suite covers WebGL. Keep asset downloads out of form tests.
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    async loadAsync() {
      throw new Error("No WebGL in form tests");
    }
  },
}));

it("shows the Sokosumi account's name and email with Sign out", () => {
  const html = renderToStaticMarkup(
    <SignedIn
      name="Ada Lovelace"
      email="ada@example.com"
      signOut={async () => {}}
    />,
  );

  expect(html).toContain('<p class="account-name">Ada Lovelace</p>');
  expect(html).toContain('<p class="note">ada@example.com</p>');
  expect(html).toMatch(
    /<button class="button button-secondary" type="submit"[^>]*><span class="button-label">Sign out<\/span><\/button>/,
  );
});

it("keeps Sign out busy until signing out settles", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let finish = () => {};
  const signOut = vi.fn(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  try {
    await act(async () => {
      root.render(
        <SignedIn name="Ada" email="ada@example.com" signOut={signOut} />,
      );
    });
    const button = container.querySelector("button");
    if (!button) throw new Error("Missing Sign out button");

    await act(async () => button.click());
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toBe("Sign out");
    expect(button.querySelector("[aria-hidden='true']")).not.toBeNull();

    await act(async () => button.click());
    expect(signOut).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute("aria-busy")).toBe(false);
    expect(button.querySelector("[aria-hidden='true']")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each(["", "   ", "\t\n"])(
  "names the account by its email when its name is %j",
  (name) => {
    const html = renderToStaticMarkup(
      <SignedIn name={name} email="ada@example.com" signOut={async () => {}} />,
    );

    expect(html).toContain('<p class="account-name">ada@example.com</p>');
    expect(html.split("ada@example.com")).toHaveLength(2);
  },
);
