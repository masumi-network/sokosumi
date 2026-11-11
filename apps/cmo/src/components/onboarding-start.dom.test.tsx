// @vitest-environment happy-dom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { OnboardFormState } from "../app/cmo-actions";
import { Onboarding } from "./onboarding";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function onboardSpy() {
  return vi.fn(
    async (previous: OnboardFormState, data: FormData) =>
      ({
        ...previous,
        attempt: previous.attempt + 1,
        websiteUrl: String(data.get("websiteUrl")),
      }) satisfies OnboardFormState,
  );
}

it("starts reading the kept website on its own, once", async () => {
  const onboard = onboardSpy();

  await act(async () =>
    root.render(
      <StrictMode>
        <Onboarding websiteUrl="acme.io" autoStart onboard={onboard} />
      </StrictMode>,
    ),
  );

  expect(onboard).toHaveBeenCalledTimes(1);
  expect(onboard.mock.lastCall?.[1].get("websiteUrl")).toBe("acme.io");
});

it("waits for the founder without a kept website", async () => {
  const onboard = onboardSpy();

  await act(async () =>
    root.render(<Onboarding websiteUrl="nmkr.io" onboard={onboard} />),
  );

  expect(onboard).not.toHaveBeenCalled();
});
