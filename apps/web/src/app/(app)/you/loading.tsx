import { YouPageSkeleton } from "@/app/you/components/you-loading-view";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function YouLoading() {
  return <YouPageSkeleton />;
}
