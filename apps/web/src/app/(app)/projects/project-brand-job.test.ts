import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearFailedProjectBrandGeneration,
  clearPendingProjectBrandJob,
  hasProjectBrandAutoStartAttempted,
  markProjectBrandAutoStartAttempted,
  readFailedProjectBrandGeneration,
  readPendingProjectBrandJob,
  saveFailedProjectBrandGeneration,
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

  it("remembers the latest failed generation until cleared", () => {
    const failure = {
      failedAt: "2026-11-20T23:56:00.000Z",
      url: "https://bad.invalid/",
    };

    saveFailedProjectBrandGeneration(PROJECT_ID, failure);
    expect(readFailedProjectBrandGeneration(PROJECT_ID)).toEqual(failure);

    clearFailedProjectBrandGeneration(PROJECT_ID);
    expect(readFailedProjectBrandGeneration(PROJECT_ID)).toBeNull();
  });

  it("drops a corrupt failed generation", () => {
    window.sessionStorage.setItem(
      `sokosumi:project-brand-failure:${PROJECT_ID}`,
      JSON.stringify({ failedAt: "yesterday", url: "https://bad.invalid/" }),
    );

    expect(readFailedProjectBrandGeneration(PROJECT_ID)).toBeNull();
    expect(
      window.sessionStorage.getItem(
        `sokosumi:project-brand-failure:${PROJECT_ID}`,
      ),
    ).toBeNull();
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
