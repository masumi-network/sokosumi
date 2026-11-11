"use client";

import { ProjectScopeRequired } from "@/app/components/project-scope/project-scope-required";
import { requestStudioWebsiteDraftOnOpen } from "@/app/projects/components/image-studio/studio-website-intent";

export function StudioProjectScopePrompt({
  body,
  createActionLabel,
}: {
  body: string;
  createActionLabel: string;
}) {
  return (
    <ProjectScopeRequired
      body={body}
      createActionLabel={createActionLabel}
      onCreated={(projectId, websiteUrl) => {
        if (websiteUrl) requestStudioWebsiteDraftOnOpen(projectId);
      }}
      testId="studio-no-project"
      variant="action"
    />
  );
}
