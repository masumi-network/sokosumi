// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import ErrorPage from "./error";

it("says plainly that something failed and lets the person try again", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const retry = vi.fn();
  try {
    await act(async () => {
      root.render(
        <ErrorPage
          error={Object.assign(new Error("boom"), { digest: "abc" })}
          retry={retry}
        />,
      );
    });

    expect(container.querySelector("h1")?.textContent).toBe(
      "Something went wrong.",
    );
    expect(container.textContent).not.toContain("boom");
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Try again");
    await act(async () => button?.click());
    expect(retry).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
