"use client";

import { ChannelProvider } from "ably/react";
import { ChevronDown, History, Pin } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ComponentType, SVGProps } from "react";

import AgentIcon from "@/components/agents/agent-icon";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import DynamicAblyProvider from "@/contexts/alby-provider.dynamic";
import { JobIndicatorStatus, makeAgentJobsChannel } from "@/lib/ably";
import { AgentWithAvailability, getAgentName } from "@/lib/db";
import { cn } from "@/lib/utils";

import AgentJobStatusIndicator from "./agent-job-status-indicator";

interface AgentListsClientProps {
  agentLists: {
    groupKey: string;
    title: string;
    agents: AgentWithAvailability[];
    initialJobIndicatorStatuses: (JobIndicatorStatus | null)[];
    noAgentsType: string;
    iconKey: string;
  }[];
  userId: string;
}

type IconKey = "pin" | "history";

const iconByKey: Record<IconKey, ComponentType<SVGProps<SVGSVGElement>>> = {
  pin: Pin,
  history: History,
};

export default function AgentListsClient({
  agentLists,
  userId,
}: AgentListsClientProps) {
  const t = useTranslations("App.Sidebar.Content.AgentLists");

  // [agentId] in params
  const { agentId } = useParams();

  return (
    <DynamicAblyProvider>
      {agentLists.map(
        ({
          groupKey,
          title,
          agents,
          initialJobIndicatorStatuses,
          noAgentsType,
          iconKey,
        }) => {
          const IconComponent = iconByKey[iconKey as IconKey];

          return (
            <Collapsible
              key={`${groupKey}-collapsible`}
              defaultOpen={agents.length > 0}
              className="group/collapsible"
            >
              <SidebarGroup key={groupKey} className="w-72 md:w-64">
                <SidebarGroupLabel className="text-sm" asChild>
                  <CollapsibleTrigger>
                    <IconComponent
                      className="text-primary mr-2 size-4"
                      aria-hidden
                    />
                    {title}
                    <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent className="mt-2">
                    {agents.length > 0 ? (
                      <SidebarMenu>
                        {agents.map((agentWithAvailability, index) => {
                          const { agent, isAvailable } = agentWithAvailability;
                          const initialJobIndicatorStatus =
                            initialJobIndicatorStatuses[index];

                          return (
                            <SidebarMenuItem key={agent.id}>
                              <SidebarMenuButton
                                asChild
                                className={cn("px-4 py-5", {
                                  "text-primary-foreground hover:text-primary-foreground active:text-primary-foreground bg-primary hover:bg-primary active:bg-primary":
                                    agentId === agent.id,
                                  "text-tertiary-foreground hover:text-foreground":
                                    agentId !== agent.id && isAvailable,
                                  "text-muted-foreground hover:text-foreground":
                                    agentId !== agent.id && !isAvailable,
                                })}
                              >
                                <SheetClose asChild>
                                  <Link href={`/agents/${agent.id}/jobs`}>
                                    <div className="group/agent-menu flex w-full items-center gap-2">
                                      <AgentIcon
                                        agent={agent}
                                        isMuted={
                                          !isAvailable && agentId !== agent.id
                                        }
                                      />
                                      <span className="flex-1 truncate">
                                        {getAgentName(agent)}
                                      </span>
                                      {isAvailable && (
                                        <ChannelProvider
                                          channelName={makeAgentJobsChannel(
                                            agent.id,
                                            userId,
                                          )}
                                        >
                                          <AgentJobStatusIndicator
                                            agentId={agent.id}
                                            userId={userId}
                                            initialJobIndicatorStatus={
                                              initialJobIndicatorStatus
                                            }
                                            className={cn("size-4", {
                                              "text-primary-foreground":
                                                agentId === agent.id,
                                              "text-primary-iris":
                                                agentId !== agent.id,
                                            })}
                                          />
                                        </ChannelProvider>
                                      )}
                                    </div>
                                  </Link>
                                </SheetClose>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          );
                        })}
                      </SidebarMenu>
                    ) : (
                      <p className="text-muted-foreground px-4 py-2 text-sm">
                        {t("noAgents", { type: noAgentsType })}
                      </p>
                    )}
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        },
      )}
    </DynamicAblyProvider>
  );
}
