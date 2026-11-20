import { render, renderHook } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, replaceMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
}));

const stableRouter = {
  push: pushMock,
  replace: replaceMock,
};

vi.mock("next/navigation", () => ({
  useRouter: () => stableRouter,
}));

import { useRouterRedirect } from "./use-router-redirect";

describe("useRouterRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces when href becomes non-null and whenever href changes", () => {
    const { rerender } = renderHook(
      ({ href, scroll }: { href: string | null; scroll?: boolean }) =>
        useRouterRedirect(href, scroll === undefined ? undefined : { scroll }),
      {
        initialProps: {
          href: null as string | null,
          scroll: undefined as boolean | undefined,
        },
      },
    );

    expect(replaceMock).not.toHaveBeenCalled();

    rerender({ href: "/tasks", scroll: undefined });
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenLastCalledWith("/tasks");

    rerender({ href: "/tasks", scroll: undefined });
    expect(replaceMock).toHaveBeenCalledTimes(1);

    rerender({ href: "/seo?auditId=1", scroll: false });
    expect(replaceMock).toHaveBeenCalledTimes(2);
    expect(replaceMock).toHaveBeenLastCalledWith("/seo?auditId=1", {
      scroll: false,
    });
  });

  it("re-runs on React Activity reveal when once is false", () => {
    function Probe({ href }: { href: string | null }) {
      useRouterRedirect(href);
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe href="/seo" />
      </Activity>,
    );
    expect(replaceMock).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        <Probe href="/seo" />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Probe href="/seo" />
      </Activity>,
    );
    expect(replaceMock).toHaveBeenCalledTimes(2);
  });

  it("pushes at most once when mode is push and once is true across StrictMode and Activity reveal", () => {
    function Probe({ href }: { href: string | null }) {
      useRouterRedirect(href, { mode: "push", once: true });
      return null;
    }

    const { rerender } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe href={null} />
        </Activity>
      </StrictMode>,
    );
    expect(pushMock).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe href="/agents/a1/jobs/j1" />
        </Activity>
      </StrictMode>,
    );
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenLastCalledWith("/agents/a1/jobs/j1");

    // Changing href or hiding/revealing Activity does not push a second time.
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe href="/agents/a1/jobs/j2" />
        </Activity>
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe href="/agents/a1/jobs/j2" />
        </Activity>
      </StrictMode>,
    );
    expect(pushMock).toHaveBeenCalledTimes(1);
  });
});
