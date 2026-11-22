import { render } from "@testing-library/react";
import {
  Activity,
  type RefObject,
  StrictMode,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { describe, expect, it } from "vitest";

import { useTaskActivityComposerUploadCleanup } from "./use-task-activity-composer-upload-cleanup";

describe("useTaskActivityComposerUploadCleanup", () => {
  it("clears isUnmountingRef on mount and aborts and clears active controllers on unmount", () => {
    const controllers = new Set<AbortController>();
    const isUnmounting = { current: true };
    const first = new AbortController();
    const second = new AbortController();

    function Probe() {
      const controllersRef = useRef(controllers);
      useTaskActivityComposerUploadCleanup(controllersRef, isUnmounting);
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(isUnmounting.current).toBe(false);

    controllers.add(first);
    controllers.add(second);
    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(false);

    unmount();
    expect(isUnmounting.current).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(controllers.size).toBe(0);
  });

  it("resets isUnmountingRef across StrictMode replay and runs in the passive effect phase", () => {
    const siblingPassiveValues: boolean[] = [];
    const siblingLayoutCleanupValues: boolean[] = [];
    const captured: {
      controllers: RefObject<Set<AbortController>> | null;
      isUnmounting: RefObject<boolean> | null;
    } = { controllers: null, isUnmounting: null };

    function Probe() {
      const controllersRef = useRef(new Set<AbortController>());
      const isUnmountingRef = useRef(false);
      captured.controllers = controllersRef;
      captured.isUnmounting = isUnmountingRef;
      useTaskActivityComposerUploadCleanup(controllersRef, isUnmountingRef);
      useLayoutEffect(() => {
        return () => {
          // Layout cleanup runs before passive cleanup, so the flag is still false here.
          siblingLayoutCleanupValues.push(isUnmountingRef.current);
        };
      }, []);
      useEffect(() => {
        siblingPassiveValues.push(isUnmountingRef.current);
      }, []);
      return null;
    }

    const { unmount } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(captured.isUnmounting?.current).toBe(false);
    expect(siblingPassiveValues).toEqual([false, false]);

    const upload = new AbortController();
    captured.controllers?.current.add(upload);

    unmount();
    expect(siblingLayoutCleanupValues).toEqual([false, false]);
    expect(captured.isUnmounting?.current).toBe(true);
    expect(upload.signal.aborted).toBe(true);
    expect(captured.controllers?.current.size).toBe(0);
  });

  it("aborts active controllers on Activity hide and re-arms on Activity reveal", () => {
    const siblingLayoutOnReveal: boolean[] = [];
    const captured: {
      controllers: RefObject<Set<AbortController>> | null;
      isUnmounting: RefObject<boolean> | null;
    } = { controllers: null, isUnmounting: null };

    function Probe() {
      const controllersRef = useRef(new Set<AbortController>());
      const isUnmountingRef = useRef(false);
      captured.controllers = controllersRef;
      captured.isUnmounting = isUnmountingRef;
      useTaskActivityComposerUploadCleanup(controllersRef, isUnmountingRef);
      useLayoutEffect(() => {
        siblingLayoutOnReveal.push(isUnmountingRef.current);
      }, []);
      return null;
    }

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(captured.isUnmounting?.current).toBe(false);
    expect(siblingLayoutOnReveal).toEqual([false]);

    const first = new AbortController();
    captured.controllers?.current.add(first);

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );
    expect(captured.isUnmounting?.current).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(captured.controllers?.current.size).toBe(0);

    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    // Passive effect resets the flag after layout effects run on reveal.
    expect(siblingLayoutOnReveal).toEqual([false, true]);
    expect(captured.isUnmounting?.current).toBe(false);

    const second = new AbortController();
    captured.controllers?.current.add(second);

    unmount();
    expect(captured.isUnmounting?.current).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(captured.controllers?.current.size).toBe(0);
  });
});
