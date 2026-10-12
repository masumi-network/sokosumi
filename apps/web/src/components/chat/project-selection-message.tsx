"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";

interface SelectedProject {
  id: string;
  name: string;
  logo?: string | null;
}

/** Recognize only the exact reply format emitted by the project picker. */
export function readProjectSelectionReply(
  content: string,
): SelectedProject | null {
  const lines = content.split("\n");
  if (lines.length === 3) {
    for (const [index, prefix] of [
      "Continue this request: ",
      "Your question: ",
    ].entries()) {
      if (!lines[index].startsWith(prefix)) return null;
      try {
        if (typeof JSON.parse(lines[index].slice(prefix.length)) !== "string")
          return null;
      } catch {
        return null;
      }
    }
  } else if (lines.length !== 1) return null;
  const match = lines
    .at(-1)
    ?.match(
      /^Use project ("(?:[^"\\]|\\.)*") \(project ID: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\.$/i,
    );
  if (!match) return null;
  try {
    const name: unknown = JSON.parse(match[1]);
    return typeof name === "string" && name.trim()
      ? { id: match[2], name }
      : null;
  } catch {
    return null;
  }
}

export function ProjectSelectionMessage({
  project,
}: {
  project: SelectedProject;
}) {
  const t = useTranslations("Components.ChatResults.selection");
  return (
    <div
      className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm"
      data-testid="project-selection-message"
    >
      <Check aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <span className="text-muted-foreground">{t("selectedProject")}</span>
      <Link
        href={`/projects/${project.id}`}
        className="bg-card-background hover:bg-card-background-hover focus-visible:ring-ring inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border px-2 py-1 outline-none focus-visible:ring-2"
        title={project.name}
      >
        <ProjectAvatar
          name={project.name}
          logo={project.logo}
          className="size-5 shrink-0"
        />
        <span className="truncate font-medium">{project.name}</span>
      </Link>
    </div>
  );
}
