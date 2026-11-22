"use client";

import { useEffect, useRef, useState } from "react";

import {
  registerStudioWorkspaceBrief,
  takeStudioBriefFor,
} from "@/app/projects/components/image-studio/studio-workspace-brief";

export function useImageStudioWorkspaceBrief(projectId: string | null) {
  const [prompt, setPrompt] = useState("");
  const latestPrompt = useRef(prompt);
  latestPrompt.current = prompt;
  // Picking or creating a project here remounts the studio. A brief typed in
  // the All-projects view moves to that project instead of vanishing.
  useEffect(() => {
    const brief = takeStudioBriefFor(projectId);
    if (brief) setPrompt(brief);
    return projectId === null
      ? registerStudioWorkspaceBrief(() => latestPrompt.current)
      : undefined;
  }, []);

  return [prompt, setPrompt] as const;
}
