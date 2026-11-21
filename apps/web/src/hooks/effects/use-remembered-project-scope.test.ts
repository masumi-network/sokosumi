import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useRememberedProjectScope } from "./use-remembered-project-scope";

describe("useRememberedProjectScope", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("persists routeProjectId when hasRouteScope is true and retains it on neutral pages", () => {
    const storageKey = JSON.stringify([
      "sokosumi.project-scope.v1",
      "user-scope-1",
      "org-1",
    ]);

    const { result, rerender } = renderHook(
      ({
        hasRouteScope,
        pathname,
        routeProjectId,
      }: {
        hasRouteScope: boolean;
        pathname: string;
        routeProjectId: string | null;
      }) =>
        useRememberedProjectScope({
          storageKey,
          hasRouteScope,
          pathname,
          routeProjectId,
        }),
      {
        initialProps: {
          hasRouteScope: true,
          pathname: "/tasks",
          routeProjectId: "proj-1" as string | null,
        },
      },
    );

    expect(sessionStorage.getItem(storageKey)).toBe("proj-1");
    expect(result.current.rememberedProjectId).toBe("proj-1");

    rerender({
      hasRouteScope: false,
      pathname: "/chat/room-1",
      routeProjectId: null,
    });
    expect(sessionStorage.getItem(storageKey)).toBe("proj-1");
    expect(result.current.rememberedProjectId).toBe("proj-1");
  });

  it("ignores the stale URL during a workspace switch until navigation changes", () => {
    const keyA = JSON.stringify([
      "sokosumi.project-scope.v1",
      "user-scope-1",
      "org-1",
    ]);
    const keyB = JSON.stringify([
      "sokosumi.project-scope.v1",
      "user-scope-1",
      "org-b",
    ]);
    sessionStorage.setItem(keyB, "proj-b");

    const { rerender } = renderHook(
      ({
        storageKey,
        pathname,
        routeProjectId,
      }: {
        storageKey: string | null;
        pathname: string;
        routeProjectId: string | null;
      }) =>
        useRememberedProjectScope({
          storageKey,
          hasRouteScope: true,
          pathname,
          routeProjectId,
        }),
      {
        initialProps: {
          storageKey: keyA as string | null,
          pathname: "/tasks",
          routeProjectId: "proj-a" as string | null,
        },
      },
    );

    expect(sessionStorage.getItem(keyA)).toBe("proj-a");

    // Workspace switches while the previous URL is still rendered.
    rerender({
      storageKey: keyB,
      pathname: "/tasks",
      routeProjectId: "proj-a",
    });
    expect(sessionStorage.getItem(keyB)).toBe("proj-b");

    // Once the user navigates to a new page, writes resume on the new workspace.
    rerender({
      storageKey: keyB,
      pathname: "/projects",
      routeProjectId: null,
    });
    expect(sessionStorage.getItem(keyB)).toBeNull();
  });

  it("updates storage and subscribers when rememberProjectId is called", () => {
    const storageKey = JSON.stringify([
      "sokosumi.project-scope.v1",
      "user-scope-3",
      "org-1",
    ]);

    const { result } = renderHook(() =>
      useRememberedProjectScope({
        storageKey,
        hasRouteScope: false,
        pathname: "/chat",
        routeProjectId: null,
      }),
    );

    expect(result.current.rememberedProjectId).toBeNull();

    act(() => {
      result.current.rememberProjectId("proj-explicit");
    });

    expect(sessionStorage.getItem(storageKey)).toBe("proj-explicit");
    expect(result.current.rememberedProjectId).toBe("proj-explicit");
  });
});
