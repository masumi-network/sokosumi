"use client";

import { SquareTerminal } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import useJobStatusEvent from "@/hooks/use-job-status-event";
import { getAgentName } from "@/lib/db";
import { PayloadSchemaType } from "@/lib/db/listener/schema";
import { cn } from "@/lib/utils";
import { Agent, Job } from "@/prisma/generated/client";

import AgentJobStatusIndicator from "./agent-job-status-indicator";

interface AgentListsClientProps {
  agentLists: {
    groupKey: string;
    title: string;
    agents: Agent[];
    latestJobs: (Job | null)[];
    noAgentsType: string;
  }[];
}

export default function AgentListsClient({
  agentLists,
}: AgentListsClientProps) {
  const t = useTranslations("App.Sidebar.Content.AgentLists");

  const router = useRouter();

  // [agentId] in params
  const { agentId } = useParams();

  const handleJobStatusEvent = useCallback(
    (_event: PayloadSchemaType) => {
      // NOTE:
      // for now just revalidate the app path
      // this will re-fetch all agent lists with latest jobs
      router.refresh();
    },
    [router],
  );

  useJobStatusEvent(handleJobStatusEvent);

  return (
    <>
      {agentLists.map(
        ({ groupKey, title, agents, latestJobs, noAgentsType }) => (
          <SidebarGroup key={groupKey} className="w-64">
            <SidebarGroupLabel className="text-base">{title}</SidebarGroupLabel>
            <SidebarGroupContent className="mt-2">
              {agents.length > 0 ? (
                <SidebarMenu>
                  {agents.map((agent, index) => (
                    <SidebarMenuItem key={agent.id}>
                      <SidebarMenuButton
                        asChild
                        className={cn({
                          "text-primary-foreground hover:text-primary-foreground active:text-primary-foreground bg-primary hover:bg-primary active:bg-primary":
                            agentId === agent.id,
                          "text-tertiary-foreground hover:text-foreground":
                            agentId !== agent.id,
                        })}
                      >
                        <Link href={`/app/agents/${agent.id}/jobs`}>
                          <div className="group/agent-menu flex w-full items-center gap-2">
                            <SquareTerminal className="h-4 w-4" />
                            <span className="flex-1 truncate">
                              {getAgentName(agent)}
                            </span>
                            {latestJobs[index] && (
                              <AgentJobStatusIndicator
                                job={latestJobs[index]}
                                className={cn("h-4 w-4", {
                                  "text-primary-foreground":
                                    agentId === agent.id,
                                  "text-primary": agentId !== agent.id,
                                })}
                              />
                            )}
                          </div>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              ) : (
                <p className="text-muted-foreground px-3 text-sm">
                  {t("noAgents", { type: noAgentsType })}
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        ),
      )}
    </>
  );
}
