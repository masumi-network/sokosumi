import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDesignMdGeneration } from "@/components/design-md/use-design-md-generation";
import {
  pollDesignMdGeneration,
  startDesignMdGeneration,
} from "@/lib/actions/design-md/action";

vi.mock("@/lib/actions/design-md/action", () => ({
  finalizeDesignMdGeneration: vi.fn(),
  pollDesignMdGeneration: vi.fn(),
  startDesignMdGeneration: vi.fn(),
}));

const URL = "https://bad.invalid/";

function renderGeneration() {
  const onFailed = vi.fn();
  const onStarted = vi.fn();
  const { result } = renderHook(() =>
    useDesignMdGeneration({
      messages: {
        generationFailed: "generation failed",
        saveFailed: "save failed",
        startFailed: "start failed",
      },
      onFailed,
      onStarted,
      owner: { type: "project", projectId: "project-1" },
      pollIntervalMs: 0,
    }),
  );
  return { onFailed, onStarted, result };
}

describe("useDesignMdGeneration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports the website of an attempt that could not start", async () => {
    vi.mocked(startDesignMdGeneration).mockResolvedValue({
      ok: false,
      error: { code: "BAD_INPUT", message: "Could not resolve bad.invalid." },
    } as Awaited<ReturnType<typeof startDesignMdGeneration>>);
    const { onFailed, onStarted, result } = renderGeneration();

    await act(() => result.current.generate({ url: URL }));

    expect(onStarted).toHaveBeenCalledWith({ url: URL });
    expect(onFailed).toHaveBeenCalledWith({ url: URL });
    expect(result.current.status).toBe("failed");
  });

  it("reports the website of a resumed job that failed", async () => {
    vi.mocked(pollDesignMdGeneration).mockResolvedValue({
      ok: true,
      value: { status: "failed", error: "Could not resolve bad.invalid." },
    } as Awaited<ReturnType<typeof pollDesignMdGeneration>>);
    const { onFailed, onStarted, result } = renderGeneration();

    await act(async () => {
      result.current.resume({ jobId: "job-1", jobToken: "token", url: URL });
      await vi.waitFor(() => expect(onFailed).toHaveBeenCalled());
    });

    expect(onFailed).toHaveBeenCalledWith({ url: URL });
    expect(onStarted).not.toHaveBeenCalled();
  });
});
