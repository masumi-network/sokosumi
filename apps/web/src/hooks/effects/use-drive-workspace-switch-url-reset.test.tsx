import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDriveWorkspaceSwitchUrlReset } from "./use-drive-workspace-switch-url-reset";

describe("useDriveWorkspaceSwitchUrlReset", () => {
  it("ignores initial workspace resolution and strips scoped params when switching workspaces", () => {
    const router = { replace: vi.fn() };
    const params = new URLSearchParams(
      "folder=Docs&view=tasks&projectId=p1&taskId=t1&assigneeId=a1&scope=org&archived=true&tags=one&q=keep",
    );

    const { rerender } = renderHook(
      ({ orgId, searchParams }) =>
        useDriveWorkspaceSwitchUrlReset(orgId, router, searchParams),
      {
        initialProps: {
          orgId: undefined as string | null | undefined,
          searchParams: params,
        },
      },
    );

    expect(router.replace).not.toHaveBeenCalled();

    rerender({ orgId: null, searchParams: params });
    expect(router.replace).not.toHaveBeenCalled();

    rerender({ orgId: "org-1", searchParams: params });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/drive?q=keep");
  });

  it("does not navigate when switching workspaces with no scoped params present", () => {
    const router = { replace: vi.fn() };
    const params = new URLSearchParams("q=hello");

    const { rerender } = renderHook(
      ({ orgId }) => useDriveWorkspaceSwitchUrlReset(orgId, router, params),
      { initialProps: { orgId: null as string | null } },
    );

    rerender({ orgId: "org-2" });
    expect(router.replace).not.toHaveBeenCalled();
  });
});
