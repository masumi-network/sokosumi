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
  const onJobStarted = vi.fn();
  const onStarted = vi.fn();
  const { result, unmount } = renderHook(() =>
    useDesignMdGeneration({
      messages: {
        generationFailed: "generation failed",
        saveFailed: "save failed",
        startFailed: "start failed",
      },
      onFailed,
      onJobStarted,
      onStarted,
      owner: { type: "project", projectId: "project-1" },
      pollIntervalMs: 0,
    }),
  );
  return { onFailed, onJobStarted, onStarted, result, unmount };
}

describe("useDesignMdGeneration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports the website of an attempt that could not start", async () => {
    vi.mocked(startDesignMdGeneration).mockResolvedValue({
      ok: false,
      error: { code: "BAD_INPUT", message: "Could not resolve bad.invalid." },
    } as Awaited<ReturnType<typeof startDesignMdGeneration>>);
    const { onFailed, onStarted, result } = renderGeneration();

    await act(async () => result.current.generate({ url: URL }));

    const attempt = { attemptId: expect.any(String), url: URL };
    expect(onStarted).toHaveBeenCalledWith(attempt);
    expect(onFailed).toHaveBeenCalledWith(attempt);
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

    // Resuming takes the job over: the same attempt starts and fails.
    const [[started]] = onStarted.mock.calls;
    expect(started).toEqual({ attemptId: expect.any(String), url: URL });
    expect(onFailed).toHaveBeenCalledWith(started);
  });

  it("hands over a job whose start answers after unmount, without polling", async () => {
    vi.useFakeTimers();
    try {
      const answer =
        Promise.withResolvers<
          Awaited<ReturnType<typeof startDesignMdGeneration>>
        >();
      vi.mocked(startDesignMdGeneration).mockReturnValue(answer.promise);
      const { onJobStarted, onStarted, result, unmount } = renderGeneration();

      await act(async () => {
        const started = result.current.generate({ url: URL });
        unmount();
        answer.resolve({
          ok: true,
          value: { kind: "queued", jobId: "job-1", jobToken: "token-1" },
        });
        await started;
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(onJobStarted).toHaveBeenCalledWith({
        attemptId: onStarted.mock.calls[0]?.[0].attemptId,
        jobId: "job-1",
        jobToken: "token-1",
        url: URL,
      });
      expect(pollDesignMdGeneration).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
