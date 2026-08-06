import { DeveloperListPageSkeleton } from "@/app/developer/components/developer-loading-view";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function DeveloperCoworkersLoading() {
  return <DeveloperListPageSkeleton />;
}
