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
import { type JobStatusData, makeAgentJobsChannelName } from "@/lib/ably";
import { getAgentName, getAgentResolvedIcon } from "@/lib/helpers/agent";
import { AgentWithAvailability } from "@/lib/types/agent";
import { cn } from "@/lib/utils";

import AgentJobStatusIndicator from "./agent-job-status-indicator";

interface AgentListsClientProps {
  agentLists: {
    groupKey: string;
    title: string;
    agents: AgentWithAvailability[];
    initialJobStatusesData: (JobStatusData | null)[];
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
          initialJobStatusesData,
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
              <SidebarGroup key={groupKey} className="w-full pt-0 pb-0">
                <SidebarGroupLabel
                  className="text-primary px-3 text-sm text-nowrap group-data-[collapsible=icon]:hidden"
                  asChild
                >
                  <CollapsibleTrigger>
                    <IconComponent className="mr-2 size-4" aria-hidden />
                    {title}
                    <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <span className="text-primary preserve-aspect-ratio-[xMidYMid_meet] hidden p-2 transition-all duration-200 group-data-[collapsible=icon]:block group-data-[collapsible=icon]:pl-3!">
                  <IconComponent className="mr-2 size-4" aria-hidden />
                </span>
                <CollapsibleContent>
                  <SidebarGroupContent className="mt-2">
                    {agents.length > 0 ? (
                      <SidebarMenu>
                        {agents.map((agentWithAvailability, index) => {
                          const { agent, isAvailable } = agentWithAvailability;
                          const initialJobStatusData =
                            initialJobStatusesData[index];
                          const agentName = getAgentName(agent);

                          return (
                            <SidebarMenuItem key={agent.id}>
                              <SidebarMenuButton
                                asChild
                                className={cn(
                                  "gap-0 pl-5 group-data-[collapsible=icon]:px-2",
                                  {
                                    "text-primary-foreground hover:text-primary-foreground active:text-primary-foreground bg-primary hover:bg-primary active:bg-primary":
                                      agentId === agent.id,
                                    "text-tertiary-foreground hover:text-foreground":
                                      agentId !== agent.id && isAvailable,
                                    "text-muted-foreground hover:text-foreground":
                                      agentId !== agent.id && !isAvailable,
                                  },
                                )}
                              >
                                <SheetClose asChild>
                                  <Link
                                    href={`/agents/${agent.id}/jobs`}
                                    className="flex min-h-auto w-full items-center justify-start gap-2"
                                  >
                                    <div className="group/agent-menu flex min-h-auto w-full items-center justify-start gap-2">
                                      <AgentIcon
                                        agent={{
                                          name: agentName,
                                          icon: getAgentResolvedIcon(agent),
                                        }}
                                        isMuted={
                                          !isAvailable && agentId !== agent.id
                                        }
                                      />
                                      <span className="flex-1 truncate">
                                        {agentName}
                                      </span>
                                      {isAvailable && (
                                        <ChannelProvider
                                          channelName={makeAgentJobsChannelName(
                                            agent.id,
                                            userId,
                                          )}
                                        >
                                          <AgentJobStatusIndicator
                                            agentId={agent.id}
                                            userId={userId}
                                            initialJobStatusData={
                                              initialJobStatusData
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
                      <p className="text-muted-foreground px-4 py-2 text-sm group-data-[collapsible=icon]:hidden">
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
