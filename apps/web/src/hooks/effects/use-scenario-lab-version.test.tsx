import type { SokoBotVersion } from "@sokosumi/core-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScenarioLabVersion } from "@/hooks/effects/use-scenario-lab-version";

const { setVersionMock } = vi.hoisted(() => ({
  setVersionMock: vi.fn(),
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  setSokoBotVersionAction: (...args: unknown[]) => setVersionMock(...args),
}));

const VERSIONS: SokoBotVersion[] = [
  {
    id: "v11",
    name: "Version 11",
    createdAt: "2026-08-01",
    summary: "Current version",
    model: "model/v11",
    skills: [],
    capabilities: null,
    inferenceRegion: null,
    systemPrompt: "Version 11 prompt",
  },
  {
    id: "v12-operator",
    name: "Operator",
    createdAt: "2026-08-27",
    summary: "Candidate version",
    model: "model/v12",
    skills: [],
    capabilities: [],
    inferenceRegion: "eu",
    systemPrompt: "Version 12 prompt",
  },
];

describe("useScenarioLabVersion", () => {
  beforeEach(() => {
    setVersionMock.mockReset();
  });

  it("applies a deep-linked version from the URL, switches Core, and notifies onTurnFinished", async () => {
    const onTurnFinished = vi.fn();
    setVersionMock.mockResolvedValue({ ok: true, value: {} });

    const { result } = renderHook(
      () => {
        const activeVersionRef = useRef<string | null>("v11");
        return useScenarioLabVersion({
          versionId: "v11",
          versions: VERSIONS,
          activeVersionRef,
          onTurnFinished,
        });
      },
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?version=v12-operator",
          hasMemory: true,
        }),
      },
    );

    await waitFor(() => {
      expect(result.current.activeVersion).toBe("v12-operator");
    });

    expect(setVersionMock).toHaveBeenCalledWith({ versionId: "v12-operator" });
    expect(result.current.switching).toBe(false);
    expect(onTurnFinished).toHaveBeenCalledTimes(1);
  });

  it("clears rejected URL versions and releases switching", async () => {
    const onUrlUpdate = vi.fn();
    setVersionMock.mockRejectedValue(new Error("RSC failure"));

    const { result } = renderHook(
      () => {
        const activeVersionRef = useRef<string | null>("v11");
        return useScenarioLabVersion({
          versionId: "v11",
          versions: VERSIONS,
          activeVersionRef,
        });
      },
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?version=v12-operator",
          hasMemory: true,
          onUrlUpdate,
        }),
      },
    );

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalled();
    });
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("version")).toBe(
      null,
    );
    await waitFor(() => {
      expect(result.current.switching).toBe(false);
    });
    expect(result.current.activeVersion).toBe("v11");
    expect(setVersionMock).toHaveBeenCalledTimes(1);
  });

  it("updates activeVersion and URL when chooseVersion succeeds", async () => {
    const onUrlUpdate = vi.fn();
    const onTurnFinished = vi.fn();
    setVersionMock.mockResolvedValue({ ok: true, value: {} });

    const { result } = renderHook(
      () => {
        const activeVersionRef = useRef<string | null>("v11");
        return useScenarioLabVersion({
          versionId: "v11",
          versions: VERSIONS,
          activeVersionRef,
          onTurnFinished,
        });
      },
      {
        wrapper: withNuqsTestingAdapter({
          hasMemory: true,
          onUrlUpdate,
        }),
      },
    );

    await act(async () => {
      await result.current.chooseVersion("v12-operator");
    });

    expect(result.current.activeVersion).toBe("v12-operator");
    expect(result.current.switching).toBe(false);
    expect(onTurnFinished).toHaveBeenCalledTimes(1);
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("version")).toBe(
      "v12-operator",
    );
  });

  it("releases switching when chooseVersion rejects", async () => {
    const onUrlUpdate = vi.fn();
    const onTurnFinished = vi.fn();
    const pending = Promise.withResolvers<never>();
    setVersionMock.mockReturnValue(pending.promise);

    const { result } = renderHook(
      () => {
        const activeVersionRef = useRef<string | null>("v11");
        return useScenarioLabVersion({
          versionId: "v11",
          versions: VERSIONS,
          activeVersionRef,
          onTurnFinished,
        });
      },
      {
        wrapper: withNuqsTestingAdapter({
          hasMemory: true,
          onUrlUpdate,
        }),
      },
    );

    let switchPromise: Promise<void> | undefined;
    act(() => {
      switchPromise = result.current.chooseVersion("v12-operator");
    });

    expect(result.current.switching).toBe(true);

    await act(async () => {
      pending.reject(new Error("RSC failure"));
      await expect(switchPromise).rejects.toThrow("RSC failure");
    });

    expect(result.current.switching).toBe(false);
    expect(result.current.activeVersion).toBe("v11");
    expect(onTurnFinished).not.toHaveBeenCalled();
    expect(onUrlUpdate).not.toHaveBeenCalled();
  });
});
