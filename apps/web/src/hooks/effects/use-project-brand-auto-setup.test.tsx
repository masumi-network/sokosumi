import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  hasProjectBrandAttemptInFlight,
  hasProjectBrandAutoStartAttempted,
  markProjectBrandAutoStartAttempted,
  readFailedProjectBrandGeneration,
  readPendingProjectBrandJob,
} from "@/app/projects/project-brand-job";

import { useProjectBrandAutoSetup } from "./use-project-brand-auto-setup";

vi.mock("@/app/projects/project-brand-job", () => ({
  hasProjectBrandAttemptInFlight: vi.fn(),
  hasProjectBrandAutoStartAttempted: vi.fn(),
  markProjectBrandAutoStartAttempted: vi.fn(),
  projectBrandWebsite: (url: string) => url,
  readFailedProjectBrandGeneration: vi.fn(),
  readPendingProjectBrandJob: vi.fn(),
}));

describe("useProjectBrandAutoSetup", () => {
  beforeEach(() => {
    vi.mocked(hasProjectBrandAttemptInFlight).mockReturnValue(false);
    vi.mocked(hasProjectBrandAutoStartAttempted).mockReturnValue(false);
    vi.mocked(readFailedProjectBrandGeneration).mockReturnValue(null);
    vi.mocked(readPendingProjectBrandJob).mockReturnValue(null);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("resumes a pending brand job once the viewer id is available", () => {
    const pending = {
      attemptId: "att-1",
      jobId: "job-1",
      jobToken: "tok-1",
      url: "https://example.com",
    };
    vi.mocked(readPendingProjectBrandJob).mockReturnValue(pending);
    const resume = vi.fn();
    const generate = vi.fn();
    const attempted = { current: false };

    const { rerender } = renderHook(
      ({ viewerId }: { viewerId: string | undefined }) =>
        useProjectBrandAutoSetup({
          autoStart: true,
          backgroundGenerationAttempted: attempted,
          designMd: null,
          generate,
          isRunning: false,
          projectId: "proj-1",
          resume,
          storageVersion: 0,
          viewerId,
          websiteUrl: "https://example.com",
        }),
      { initialProps: { viewerId: undefined as string | undefined } },
    );

    expect(resume).not.toHaveBeenCalled();

    rerender({ viewerId: "user-1" });
    expect(resume).toHaveBeenCalledWith(pending);
    expect(generate).not.toHaveBeenCalled();
    expect(attempted.current).toBe(true);
  });

  it("auto-starts generation once when no designMd, pending job, or matching failure exists", () => {
    const resume = vi.fn();
    const generate = vi.fn();
    const attempted = { current: false };

    renderHook(() =>
      useProjectBrandAutoSetup({
        autoStart: true,
        backgroundGenerationAttempted: attempted,
        designMd: null,
        generate,
        isRunning: false,
        projectId: "proj-1",
        resume,
        storageVersion: 0,
        viewerId: "user-1",
        websiteUrl: "https://example.com",
      }),
    );

    expect(markProjectBrandAutoStartAttempted).toHaveBeenCalledWith("proj-1");
    expect(generate).toHaveBeenCalledWith({ url: "https://example.com" });
    expect(attempted.current).toBe(true);
  });

  it("marks auto-start attempted and skips generation when designMd already exists", () => {
    const generate = vi.fn();
    const attempted = { current: false };

    renderHook(() =>
      useProjectBrandAutoSetup({
        autoStart: true,
        backgroundGenerationAttempted: attempted,
        designMd: {
          extractionId: "ext-1",
          url: "https://cdn.example/design.md",
        },
        generate,
        isRunning: false,
        projectId: "proj-1",
        resume: vi.fn(),
        storageVersion: 0,
        viewerId: "user-1",
        websiteUrl: "https://example.com",
      }),
    );

    expect(attempted.current).toBe(true);
    expect(markProjectBrandAutoStartAttempted).toHaveBeenCalledWith("proj-1");
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not auto-retry when the same website already failed for this viewer", () => {
    vi.mocked(readFailedProjectBrandGeneration).mockReturnValue({
      failedAt: "2026-11-22T00:00:00.000Z",
      website: "https://example.com",
    });
    const generate = vi.fn();
    const attempted = { current: false };

    renderHook(() =>
      useProjectBrandAutoSetup({
        autoStart: true,
        backgroundGenerationAttempted: attempted,
        designMd: null,
        generate,
        isRunning: false,
        projectId: "proj-1",
        resume: vi.fn(),
        storageVersion: 0,
        viewerId: "user-1",
        websiteUrl: "https://example.com",
      }),
    );

    expect(generate).not.toHaveBeenCalled();
    expect(attempted.current).toBe(false);
  });
});
