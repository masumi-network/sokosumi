import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearPendingProjectBrandJob,
  hasProjectBrandAutoStartAttempted,
  markProjectBrandAutoStartAttempted,
  projectBrandJobCallbacks,
  readFailedProjectBrandGeneration,
  readPendingProjectBrandJob,
  savePendingProjectBrandJob,
} from "@/app/projects/project-brand-job";

const PROJECT_ID = "project-1";

describe("project brand job storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("round-trips pending jobs and auto-start state", () => {
    const job = {
      jobId: "job-1",
      jobToken: "token-1",
      url: "https://example.com",
    };

    savePendingProjectBrandJob(PROJECT_ID, job);
    markProjectBrandAutoStartAttempted(PROJECT_ID);

    expect(readPendingProjectBrandJob(PROJECT_ID)).toEqual(job);
    expect(hasProjectBrandAutoStartAttempted(PROJECT_ID)).toBe(true);

    clearPendingProjectBrandJob(PROJECT_ID);
    expect(readPendingProjectBrandJob(PROJECT_ID)).toBeNull();
  });

  it("drops corrupt pending jobs", () => {
    window.sessionStorage.setItem(
      `sokosumi:project-brand-job:${PROJECT_ID}`,
      JSON.stringify({ jobId: 123 }),
    );

    expect(readPendingProjectBrandJob(PROJECT_ID)).toBeNull();
    expect(
      window.sessionStorage.getItem(`sokosumi:project-brand-job:${PROJECT_ID}`),
    ).toBeNull();
  });

  it("keeps the latest failure per viewer until an attempt starts", () => {
    const lifecycle = projectBrandJobCallbacks(PROJECT_ID, "viewer-1");

    lifecycle.onFailed({ url: "https://me:secret@bad.invalid/shop?x=1#top" });
    // Only what names the attempt: no sign-in details, query or fragment.
    expect(readFailedProjectBrandGeneration(PROJECT_ID, "viewer-1")).toEqual({
      failedAt: expect.any(String),
      website: "https://bad.invalid/shop",
    });
    expect(readFailedProjectBrandGeneration(PROJECT_ID, "viewer-2")).toBeNull();

    lifecycle.onStarted();
    expect(readFailedProjectBrandGeneration(PROJECT_ID, "viewer-1")).toBeNull();
  });

  it("keeps no failure without a viewer", () => {
    projectBrandJobCallbacks(PROJECT_ID, undefined).onFailed({
      url: "https://bad.invalid/",
    });

    expect(window.sessionStorage.length).toBe(0);
  });

  it("drops a corrupt failed generation", () => {
    const key = `sokosumi:project-brand-failure:viewer-1:${PROJECT_ID}`;
    window.sessionStorage.setItem(
      key,
      JSON.stringify({
        failedAt: "yesterday",
        website: "https://bad.invalid/",
      }),
    );

    expect(readFailedProjectBrandGeneration(PROJECT_ID, "viewer-1")).toBeNull();
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("does not fail generation flows when storage is unavailable", () => {
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(() =>
      savePendingProjectBrandJob(PROJECT_ID, {
        jobId: "job-1",
        jobToken: "token-1",
        url: "https://example.com",
      }),
    ).not.toThrow();
    expect(readPendingProjectBrandJob(PROJECT_ID)).toBeNull();
    expect(hasProjectBrandAutoStartAttempted(PROJECT_ID)).toBe(false);
    expect(() => markProjectBrandAutoStartAttempted(PROJECT_ID)).not.toThrow();
    expect(() => clearPendingProjectBrandJob(PROJECT_ID)).not.toThrow();
  });
});
