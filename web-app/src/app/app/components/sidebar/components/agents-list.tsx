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
import {
  getFavoriteAgents,
  getHiredAgentsWithJobs,
} from "@/lib/db/services/agent.service";
import { AppRoute } from "@/types/routes";

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
  const hiredAgents = await getHiredAgentsWithJobs(session.user.id);

  return (
    <ScrollArea className="h-full">
      <SidebarGroup key="favorite-agents">
        <SidebarGroupLabel className="text-base">
          {t("pinnedTitle")}
        </SidebarGroupLabel>
        <SidebarGroupContent className="mt-2">
          {favoriteAgents.length > 0 ? (
            <SidebarMenu>
              {favoriteAgents.map((agent) => (
                <SidebarMenuItem key={agent.id}>
                  <SidebarMenuButton asChild>
                    <Link href={`${AppRoute.Jobs}/${agent.id}`}>
                      <span className="whitespace-nowrap">{agent.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          ) : (
            <p className="text-muted-foreground px-3 text-sm">
              {t("noAgents", { type: t("pinnedType") })}
            </p>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup key="hired-agents">
        <SidebarGroupLabel className="text-base">
          {t("hiredTitle")}
        </SidebarGroupLabel>
        <SidebarGroupContent className="mt-2">
          {hiredAgents.length > 0 ? (
            <SidebarMenu>
              {hiredAgents.map((agent) => (
                <SidebarMenuItem key={agent.id}>
                  <SidebarMenuButton asChild>
                    <Link href={`${AppRoute.Jobs}/${agent.id}`}>
                      <span className="whitespace-nowrap">{agent.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          ) : (
            <p className="text-muted-foreground px-3 text-sm">
              {t("noAgents", { type: t("hiredType") })}
            </p>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

export default function AgentsList() {
  return (
    <Suspense fallback={<AgentsListSkeleton />}>
      <AgentsListContent />
    </Suspense>
  );
}
