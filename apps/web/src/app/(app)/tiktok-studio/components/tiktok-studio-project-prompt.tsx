"use client";

import { ProjectScopeRequired } from "@/app/components/project-scope/project-scope-required";
import { useProjectScopeSwitch } from "@/app/components/project-scope/use-project-scope";

export function TikTokStudioProjectPrompt({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const { select } = useProjectScopeSwitch();
  return (
    <ProjectScopeRequired
      body={body}
      onSelect={select}
      testId="tiktok-studio-no-project"
      title={title}
    />
  );
}
