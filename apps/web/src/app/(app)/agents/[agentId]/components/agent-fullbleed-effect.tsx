"use client";

import { useAgentFullbleedBody } from "@/hooks/effects/use-agent-fullbleed-body";

/**
 * Toggles `data-agent-fullbleed="true"` on `<body>` while the agent detail
 * segment is mounted. Global CSS keys off the body attribute (not `:has`) so
 * Next.js Activity / Instant Navigations cannot leave a hidden marker in the
 * tree that would keep gallery `main` padding at 0 after soft nav away.
 */
export default function AgentFullbleedEffect() {
  useAgentFullbleedBody();
  return null;
}
