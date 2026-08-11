import { ProjectsPageSkeleton } from "@/app/projects/components/projects-loading-view";

/** Sync shell only — no cookies/`connection()`/i18n (Instant Nav). */
export default function ProjectsRootLoading() {
  return <ProjectsPageSkeleton />;
}
