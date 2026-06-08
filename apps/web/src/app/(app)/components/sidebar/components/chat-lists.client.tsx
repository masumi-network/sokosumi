"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  getBucketKeyFromMetadata,
  resolveBucketKeyFromDisplaySlug,
} from "@/app/chat/utils/bucket-slug";
import { buildChatGroups, type ChatGroup } from "@/app/chat/utils/chat-groups";
import type { Coworker } from "@/app/chat/utils/types";
import {
  getBucketSlugFromChatPathname,
  getConversationIdFromChatPathname,
} from "@/app/chat-ui/utils/chat-route-base";
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
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useConversationsContext } from "@/contexts/conversations-context";
import { useCoworkersContext } from "@/contexts/coworkers-context";
import { cn } from "@/lib/utils";

export default function ChatListsClient() {
  const t = useTranslations("App.Sidebar.Content.ChatLists");
  const pathname = usePathname();
  const { conversations, isLoading } = useConversationsContext();
  const { coworkers } = useCoworkersContext();
  const params = useParams<{
    bucketSlug?: string;
    conversationId?: string;
  }>();
  const conversationIdFromPath = useMemo(
    () => getConversationIdFromChatPathname(pathname ?? ""),
    [pathname],
  );
  const conversationId =
    params?.conversationId ?? conversationIdFromPath ?? null;
  const bucketSlug = useMemo(
    () => params?.bucketSlug ?? getBucketSlugFromChatPathname(pathname ?? ""),
    [params?.bucketSlug, pathname],
  );
  const isChatRoute = pathname.startsWith("/chat");

  const chatGroups = useMemo(
    () =>
      buildChatGroups(
        conversations,
        t("untitledChat", { default: "Untitled Chat" }),
      ),
    [conversations, t],
  );

  const currentBucketKey = useMemo(() => {
    if (conversationId && conversations.length) {
      const conv = conversations.find((c) => c.id === conversationId);
      if (conv) {
        return getBucketKeyFromMetadata(
          (conv.metadata as Record<string, unknown>) || null,
        );
      }
    }

    return resolveBucketKeyFromDisplaySlug(
      conversations,
      coworkers,
      bucketSlug,
    );
  }, [bucketSlug, conversationId, conversations, coworkers]);

  const hasAnyChats = conversations.length > 0;
  const showInitialLoading = isLoading && !hasAnyChats;
  const [isOpen, setIsOpen] = useState(true);
  const prevHasAnyChats = useRef(hasAnyChats);

  useEffect(() => {
    if (hasAnyChats && !prevHasAnyChats.current) {
      startTransition(() => setIsOpen(true));
    }
    prevHasAnyChats.current = hasAnyChats;
  }, [hasAnyChats]);

  return (
    <Collapsible
      key="chat-lists-collapsible-1"
      open={isOpen}
      onOpenChange={setIsOpen}
      className="group/collapsible"
    >
      <SidebarGroup
        key="chat-lists-group-1"
        className="w-full pb-0 whitespace-nowrap"
      >
        <SidebarGroupLabel
          className="text-primary px-3 text-sm group-data-[collapsible=icon]:hidden"
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
          <SidebarGroupContent>
            {showInitialLoading ? (
              <div className="space-y-2 px-4 py-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : hasAnyChats ? (
              <SidebarMenu className="pt-2">
                {chatGroups.map((group) => {
                  const slug = group.displaySlug;
                  const mostRecentConversation = group.conversations[0];
                  const isActive =
                    isChatRoute && currentBucketKey === group.key;
                  const chatHref =
                    mostRecentConversation != null
                      ? `/chat/${slug}/conversation/${mostRecentConversation.id}`
                      : `/chat/${slug}`;
                  return (
                    <SidebarMenuItem key={group.key}>
                      <SidebarMenuButton
                        asChild
                        className={cn(
                          "group/chat-item gap-0 pl-5 group-data-[collapsible=icon]:px-2",
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
                            className="flex min-h-auto w-full items-center justify-start gap-2"
                            href={chatHref}
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
            (c: Coworker) => c.id === coworkerId,
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
