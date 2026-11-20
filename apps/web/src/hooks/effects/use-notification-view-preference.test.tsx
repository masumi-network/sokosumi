import { act, render, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setNotificationViewPreference } from "@/contexts/notification-view-storage";
import { useNotificationViewPreference } from "./use-notification-view-preference";

describe("useNotificationViewPreference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("restores the persisted view in a layout effect before passive effects run and persists switches", () => {
    setNotificationViewPreference("unread");
    const observedInPassiveEffect: string[] = [];

    function Probe() {
      const { view, viewRef } = useNotificationViewPreference();
      useEffect(() => {
        observedInPassiveEffect.push(viewRef.current);
      }, [viewRef]);
      return <span data-view={view} />;
    }

    const { container } = render(<Probe />);
    expect(observedInPassiveEffect).toEqual(["unread"]);
    expect(container.querySelector("span")?.getAttribute("data-view")).toBe(
      "unread",
    );
  });

  it("updates state, ref, and localStorage via commitView and starts at all during SSR", () => {
    const { result } = renderHook(() => useNotificationViewPreference());
    expect(result.current.view).toBe("all");
    expect(result.current.viewRef.current).toBe("all");

    act(() => {
      result.current.commitView("mentions");
    });

    expect(result.current.view).toBe("mentions");
    expect(result.current.viewRef.current).toBe("mentions");

    function SsrProbe() {
      const { view } = useNotificationViewPreference();
      return <span>{view}</span>;
    }

    expect(renderToString(<SsrProbe />)).toBe("<span>all</span>");
  });
});
