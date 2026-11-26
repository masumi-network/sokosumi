"use client";

import type { ProjectDesignMd } from "@sokosumi/core-client";
import { type RefObject, useEffect } from "react";

import {
  hasProjectBrandAttemptInFlight,
  hasProjectBrandAutoStartAttempted,
  markProjectBrandAutoStartAttempted,
  type PendingProjectBrandJob,
  projectBrandWebsite,
  readFailedProjectBrandGeneration,
  readPendingProjectBrandJob,
} from "@/app/projects/project-brand-job";

interface UseProjectBrandAutoSetupOptions {
  autoStart: boolean;
  backgroundGenerationAttempted: RefObject<boolean>;
  designMd: ProjectDesignMd | null;
  generate: (input: { url: string }) => Promise<void> | void;
  isRunning: boolean;
  projectId: string;
  resume: (job: PendingProjectBrandJob) => void;
  storageVersion: number;
  viewerId: string | undefined;
  websiteUrl: string | null | undefined;
}

export function useProjectBrandAutoSetup({
  autoStart,
  backgroundGenerationAttempted,
  designMd,
  generate,
  isRunning,
  projectId,
  resume,
  storageVersion,
  viewerId,
  websiteUrl,
}: UseProjectBrandAutoSetupOptions): void {
  // Background brand setup: the wizard may have closed mid-generation, so pick
  // up its pending job here; if there is none but the project has a website
  // and no DESIGN.md yet, kick generation off once so it lands on its own.
  useEffect(() => {
    if (designMd) {
      // Prevent an explicit remove from immediately recreating a brand when
      // a server re-render remounts this provider in the same browser session.
      backgroundGenerationAttempted.current = true;
      markProjectBrandAutoStartAttempted(projectId);
      return;
    }
    if (isRunning) return;
    // Wait for the viewer, so a failure this attempt meets is kept.
    if (!viewerId) return;
    const pending = readPendingProjectBrandJob(projectId);
    if (pending) {
      if (backgroundGenerationAttempted.current) return;
      backgroundGenerationAttempted.current = true;
      resume(pending);
      return;
    }
    if (!autoStart || !websiteUrl) return;
    if (backgroundGenerationAttempted.current) return;
    if (hasProjectBrandAutoStartAttempted(projectId)) return;
    // A start elsewhere (the wizard's) hands its job over when it answers.
    if (hasProjectBrandAttemptInFlight(projectId)) return;
    // A failure on this website (the wizard's too) waits for the owner, not
    // a silent retry. One on an older website does not count.
    if (
      readFailedProjectBrandGeneration(projectId, viewerId)?.website ===
      projectBrandWebsite(websiteUrl)
    ) {
      return;
    }
    backgroundGenerationAttempted.current = true;
    markProjectBrandAutoStartAttempted(projectId);
    void generate({ url: websiteUrl });
  }, [
    autoStart,
    designMd,
    generate,
    isRunning,
    projectId,
    resume,
    storageVersion,
    viewerId,
    websiteUrl,
  ]);
}
