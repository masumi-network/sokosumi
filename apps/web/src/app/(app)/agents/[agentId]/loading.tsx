import { AgentDetailPageSkeleton } from "@/components/agents";

/** Sync shell only — no cookies/`connection()`/i18n (Instant Nav). */
export default function AgentDetailLoading() {
  return <AgentDetailPageSkeleton />;
}
