"use client";

import { ProjectScopeRequired } from "@/app/components/project-scope/project-scope-required";
import { useProjectScopeSwitch } from "@/app/components/project-scope/use-project-scope";
import { requestStudioWebsiteDraftOnOpen } from "@/app/projects/components/image-studio/studio-website-intent";
import { handStudioBriefTo } from "@/app/projects/components/image-studio/studio-workspace-brief";

export function StudioProjectScopePrompt({
  body,
  createActionLabel,
}: {
  body: string;
  createActionLabel: string;
}) {
  const { select } = useProjectScopeSwitch();
  return (
    <ProjectScopeRequired
      body={body}
      createActionLabel={createActionLabel}
      onCreated={(projectId, websiteUrl) => {
        if (websiteUrl) requestStudioWebsiteDraftOnOpen(projectId);
      }}
      // Picked or just created here: the brief typed above goes with it.
      onSelect={(projectId) => {
        handStudioBriefTo(projectId);
        select(projectId);
      }}
      testId="studio-no-project"
      variant="action"
    />
  );
}
