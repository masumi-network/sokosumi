// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOnboardingReturnNotice } from "./use-onboarding-return-notice";

describe("useOnboardingReturnNotice (CMO)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the connect return error and clears the query when not returning from checkout", async () => {
    window.history.replaceState(null, "", "/?connect=cancelled");

    function Probe({
      returnedFromCheckout,
    }: {
      returnedFromCheckout: boolean;
    }) {
      const notice = useOnboardingReturnNotice(returnedFromCheckout);
      return <p>{notice ?? "none"}</p>;
    }

    await act(async () => root.render(<Probe returnedFromCheckout={false} />));
    expect(container.textContent).not.toBe("none");
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/");
  });

  it("keeps Polar's checkout return query intact when returnedFromCheckout is true", async () => {
    window.history.replaceState(null, "", "/?checkout=ok");

    function Probe({
      returnedFromCheckout,
    }: {
      returnedFromCheckout: boolean;
    }) {
      const notice = useOnboardingReturnNotice(returnedFromCheckout);
      return <p>{notice ?? "none"}</p>;
    }

    await act(async () => root.render(<Probe returnedFromCheckout />));
    expect(window.location.search).toBe("?checkout=ok");
    expect(renderToString(<Probe returnedFromCheckout={false} />)).toBe(
      "<p>none</p>",
    );
  });
});
