"use client";

import { SquareTerminal } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { AgentWithAvailability, getAgentName } from "@/lib/db";
import { cn } from "@/lib/utils";

interface AgentListsClientProps {
  agentLists: {
    groupKey: string;
    title: string;
    agents: AgentWithAvailability[];
    noAgentsType: string;
  }[];
}

export default function AgentListsClient({
  agentLists,
}: AgentListsClientProps) {
  const t = useTranslations("App.Sidebar.Content.AgentLists");

  // [agentId] in params
  const { agentId } = useParams();

  return (
    <>
      {agentLists.map(({ groupKey, title, agents, noAgentsType }) => (
        <SidebarGroup key={groupKey} className="w-72 md:w-64">
          <SidebarGroupLabel className="text-base">{title}</SidebarGroupLabel>
          <SidebarGroupContent className="mt-2">
            {agents.length > 0 ? (
              <SidebarMenu>
                {agents.map((agentWithAvailability) => {
                  const { agent, isAvailable } = agentWithAvailability;
                  return (
                    <SidebarMenuItem key={agent.id}>
                      <SidebarMenuButton
                        asChild
                        className={cn({
                          "text-primary-foreground hover:text-primary-foreground active:text-primary-foreground bg-primary hover:bg-primary active:bg-primary":
                            agentId === agent.id,
                          "text-tertiary-foreground hover:text-foreground":
                            agentId !== agent.id && isAvailable,
                          "text-muted-foreground hover:text-foreground":
                            agentId !== agent.id && !isAvailable,
                        })}
                      >
                        <Link href={`/agents/${agent.id}/jobs`}>
                          <div className="group/agent-menu flex w-full items-center gap-2">
                            <SquareTerminal
                              className={cn("h-4 w-4", {
                                "text-gray-500":
                                  !isAvailable && agentId !== agent.id,
                              })}
                            />
                            <span className="flex-1 truncate">
                              {getAgentName(agent)}
                            </span>
                          </div>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            ) : (
              <p className="text-muted-foreground px-3 text-sm">
                {t("noAgents", { type: noAgentsType })}
              </p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
