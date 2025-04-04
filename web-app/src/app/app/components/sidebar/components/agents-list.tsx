import { Agent } from "@prisma/client";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAuthentication } from "@/lib/auth/utils";
import { getName } from "@/lib/db/extension/agent";
import {
  getFavoriteAgents,
  getHiredAgentsOrderedByLatestJob,
} from "@/lib/db/services/agent.service";
import { AppRoute } from "@/types/routes";

export default function AgentsList() {
  return (
    <Suspense fallback={<AgentsListSkeleton />}>
      <AgentsListContent />
    </Suspense>
  );
}

function AgentsListSkeleton() {
  return (
    <ScrollArea className="h-full">
      {[1, 2].map((groupIndex) => (
        <SidebarGroup key={groupIndex}>
          <SidebarGroupLabel className="text-base">
            <Skeleton className="h-5 w-24" />
          </SidebarGroupLabel>
          <SidebarGroupContent className="mt-2">
            <SidebarMenu>
              {[1, 2, 3].map((itemIndex) => (
                <SidebarMenuItem key={itemIndex}>
                  <SidebarMenuButton asChild>
                    <Skeleton className="h-4 w-32" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

async function AgentsListContent() {
  const t = await getTranslations("App.Sidebar.Content.AgentsList");
  const { session } = await requireAuthentication();

  const favoriteAgents = await getFavoriteAgents(session.user.id);
  const hiredAgents = await getHiredAgentsOrderedByLatestJob(session.user.id);

  return (
    <ScrollArea className="h-full">
      <AgentSection
        groupKey="favorite-agents"
        title={t("pinnedTitle")}
        agents={favoriteAgents}
        noAgentsType={t("pinnedType")}
        t={t}
      />

      <AgentSection
        groupKey="hired-agents"
        title={t("hiredTitle")}
        agents={hiredAgents}
        noAgentsType={t("hiredType")}
        t={t}
      />

      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

interface AgentSectionProps {
  groupKey: string;
  title: string;
  agents: Agent[];
  noAgentsType: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}

function AgentSection({
  groupKey,
  title,
  agents,
  noAgentsType,
  t,
}: AgentSectionProps) {
  return (
    <SidebarGroup key={groupKey}>
      <SidebarGroupLabel className="text-base">{title}</SidebarGroupLabel>
      <SidebarGroupContent className="mt-2">
        {agents.length > 0 ? (
          <SidebarMenu>
            {agents.map((agent) => (
              <SidebarMenuItem key={agent.id}>
                <SidebarMenuButton asChild>
                  <Link href={`${AppRoute.Agents}/${agent.id}/jobs`}>
                    <span className="whitespace-nowrap">{getName(agent)}</span>
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
  );
}
