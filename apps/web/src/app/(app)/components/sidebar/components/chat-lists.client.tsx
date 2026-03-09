"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";

import { buildChatGroups, type ChatGroup } from "@/app/chat/utils/chat-groups";
import type { Coworker } from "@/app/chat/utils/types";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { useChatSecondarySidebar } from "@/contexts/chat-secondary-sidebar-context";
import { useConversationsContext } from "@/contexts/conversations-context";
import { useCoworkersContext } from "@/contexts/coworkers-context";
import { cn } from "@/lib/utils";

export default function ChatListsClient() {
  const t = useTranslations("App.Sidebar.Content.ChatLists");
  const { open, isMobile, toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const { setShowSecondarySidebar } = useChatSecondarySidebar();
  const { conversations, refreshConversations } = useConversationsContext();
  const { coworkers } = useCoworkersContext();
  const params = useParams<{ bucketSlug?: string }>();
  const bucketSlug = params?.bucketSlug;
  const isChatRoute = pathname.startsWith("/chat");

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const handleChatClick = () => {
    if (!isMobile && open) {
      toggleSidebar();
    }
  };

  const chatGroups = useMemo(
    () =>
      buildChatGroups(
        conversations,
        t("untitledChat", { default: "Untitled Chat" }),
      ),
    [conversations, t],
  );

  const hasAnyChats = conversations.length > 0;

  return (
    <Collapsible defaultOpen={hasAnyChats} className="group/collapsible">
      <SidebarGroup className="w-72 md:w-64">
        <SidebarGroupLabel
          className="text-primary text-sm group-data-[collapsible=icon]:hidden"
          asChild
        >
          <CollapsibleTrigger>
            <MessageSquare className="mr-2 size-4" aria-hidden />
            {t("title", { default: "Recent Chats" })}
            <span className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180">
              <svg
                className="size-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </span>
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <span className="text-primary preserve-aspect-ratio-[xMidYMid_meet] hidden p-2 transition-all duration-200 group-data-[collapsible=icon]:block group-data-[collapsible=icon]:pl-3!">
          <MessageSquare className="mr-2 size-4" aria-hidden />
        </span>
        <CollapsibleContent>
          <SidebarGroupContent className="mt-2">
            {hasAnyChats ? (
              <SidebarMenu>
                {chatGroups.map((group) => {
                  const slug = group.displaySlug;
                  const mostRecentConversation = group.conversations[0];
                  const isActive = isChatRoute && bucketSlug === slug;
                  const chatHref =
                    mostRecentConversation != null
                      ? `/chat/${slug}/conversation/${mostRecentConversation.id}`
                      : `/chat/${slug}`;
                  return (
                    <SidebarMenuItem key={group.key}>
                      <SidebarMenuButton
                        asChild
                        className={cn(
                          "group/chat-item px-4 py-5 group-data-[collapsible=icon]:px-2",
                          {
                            "text-primary-foreground hover:text-primary-foreground active:text-primary-foreground bg-primary hover:bg-primary active:bg-primary":
                              isActive,
                            "text-tertiary-foreground hover:text-foreground":
                              !isActive,
                          },
                        )}
                      >
                        <SheetClose asChild>
                          <Link
                            href={chatHref}
                            onClick={() => {
                              setShowSecondarySidebar(true);
                              handleChatClick();
                            }}
                          >
                            <div className="group/chat-menu flex w-full items-center justify-start gap-2 group-data-[collapsible=icon]:justify-center">
                              <GroupAvatar
                                group={group}
                                coworkers={coworkers}
                                t={t}
                                isActive={isActive}
                              />
                              <span className="min-w-0 flex-1 truncate text-sm group-data-[collapsible=icon]:hidden">
                                {group.displayName}
                              </span>
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
                {t("noChats", { default: "No chats yet" })}
              </p>
            )}
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

interface GroupAvatarProps {
  group: ChatGroup;
  coworkers: Coworker[];
  t: (key: string, opts?: { default?: string }) => string;
  isActive: boolean;
}

function GroupAvatar({ group, coworkers, t, isActive }: GroupAvatarProps) {
  const { modelId, modelName, coworkerId, coworkerName } = group;

  return (
    <Avatar className={cn("size-6 shrink-0 overflow-hidden rounded-full")}>
      {modelId ? (
        <ChatModelIcon
          modelId={modelId}
          modelName={modelName ?? t("modelAlt")}
          size={20}
          className="size-full p-0.5"
        />
      ) : coworkerId ? (
        (() => {
          const coworkerFromList = coworkers.find(
            (c: Coworker) => c.id === coworkerId || c.slug === coworkerId,
          );
          const avatarUrl = coworkerFromList?.avatar ?? null;
          return (
            <>
              {avatarUrl ? (
                <AvatarImage
                  src={avatarUrl}
                  alt={coworkerName ?? coworkerId}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback
                className={cn(
                  "bg-primary text-primary-foreground text-xs",
                  isActive && "bg-primary-foreground text-primary",
                )}
              >
                {coworkerName
                  ? coworkerName.charAt(0).toUpperCase()
                  : coworkerId.charAt(0).toUpperCase()}
              </AvatarFallback>
            </>
          );
        })()
      ) : (
        <AvatarFallback
          className={cn(
            "bg-primary text-primary-foreground text-xs",
            isActive && "bg-primary-foreground text-primary",
          )}
        >
          {coworkerName
            ? coworkerName.charAt(0)
            : modelName
              ? modelName.charAt(0).toUpperCase()
              : "C"}
        </AvatarFallback>
      )}
    </Avatar>
  );
}
