import type { Metadata } from "next";

import {
  APP_MAIN_MOBILE_PT_CLASS,
  APP_SHELL_BELOW_HEADER_MIN_HEIGHT_CLASS,
} from "@/app/components/app-shell-safe-area";
import { getCoreAgentById } from "@/lib/agents/core-loaders";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ agentId: string }>;
}): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await getCoreAgentById(agentId);

  return {
    title: agent?.name ?? agentId,
    description: agent?.description ?? undefined,
  };
}

export default function AgentDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      data-agent-fullbleed
      className={cn(
        "flex flex-1 flex-col",
        APP_SHELL_BELOW_HEADER_MIN_HEIGHT_CLASS,
        APP_MAIN_MOBILE_PT_CLASS,
        "md:pt-0",
      )}
    >
      {children}
    </div>
  );
}
