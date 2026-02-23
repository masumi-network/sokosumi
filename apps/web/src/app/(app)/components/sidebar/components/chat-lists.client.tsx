"use client";

import { MessageSquare } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type SyntheticEvent, useEffect, useMemo } from "react";

import { displaySlugFromMetadata, slugify } from "@/app/chat/utils/bucket-slug";
import { getModelImageUrl } from "@/app/chat/utils/model-utils";
import type { Coworker } from "@/app/chat/utils/types";
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
import { useConversationsContext } from "@/contexts/conversations-context";
import { useCoworkersContext } from "@/contexts/coworkers-context";
import type { Conversation } from "@/lib/actions/conversation";
import { cn } from "@/lib/utils";

type ConversationMetadata = {
  coworker_name?: string;
  coworker_id?: string;
  model_id?: string;
  model_name?: string;
  type?: string;
};

function getGroupKey(metadata: ConversationMetadata | null): string {
  if (!metadata) return "other";
  if (metadata.model_id) return `model:${metadata.model_id}`;
  if (metadata.coworker_id) return `coworker:${metadata.coworker_id}`;
  return "other";
}

interface ChatGroup {
  key: string;
  displayName: string;
  displaySlug: string;
  modelId: string | null;
  modelName: string | null;
  coworkerId: string | null;
  coworkerName: string | null;
  conversations: Conversation[];
  latestUpdatedAt: number;
}

function buildChatGroups(
  conversations: Conversation[],
  untitledLabel: string,
): ChatGroup[] {
  const byKey = new Map<
    string,
    {
      displayName: string;
      modelId: string | null;
      modelName: string | null;
      coworkerId: string | null;
      coworkerName: string | null;
      conversations: Conversation[];
    }
  >();

  for (const conv of conversations) {
    const meta = (conv.metadata as ConversationMetadata | null) ?? null;
    const key = getGroupKey(meta);
    const modelId = meta?.model_id ?? null;
    const modelName = meta?.model_name ?? null;
    const coworkerId = meta?.coworker_id ?? null;
    const coworkerName = meta?.coworker_name ?? null;
    const displayName = modelName ?? coworkerName ?? untitledLabel;

    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        displayName,
        modelId,
        modelName,
        coworkerId,
        coworkerName,
        conversations: [],
      };
      byKey.set(key, entry);
    }
    entry.conversations.push(conv);
  }

  const groups: ChatGroup[] = [];
  for (const [key, entry] of byKey) {
    const sorted = [...entry.conversations].sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      return tb - ta;
    });
    const firstMeta =
      (sorted[0]?.metadata as ConversationMetadata | null) ?? null;
    const displaySlug =
      displaySlugFromMetadata(firstMeta) || slugify(entry.displayName) || key;
    const latestUpdatedAt =
      sorted.length > 0 ? new Date(sorted[0].updatedAt).getTime() : 0;
    groups.push({
      key,
      displayName: entry.displayName,
      displaySlug,
      modelId: entry.modelId,
      modelName: entry.modelName,
      coworkerId: entry.coworkerId,
      coworkerName: entry.coworkerName,
      conversations: sorted,
      latestUpdatedAt,
    });
  }
  groups.sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
  return groups;
}

export default function ChatListsClient() {
  const t = useTranslations("App.Sidebar.Content.ChatLists");
  const { open, isMobile, toggleSidebar } = useSidebar();
  const { conversations, refreshConversations } = useConversationsContext();
  const { coworkers } = useCoworkersContext();
  const params = useParams<{ bucketSlug?: string }>();
  const bucketSlug = params?.bucketSlug;

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
                  const isActive = bucketSlug === slug;
                  const mostRecentConversation = group.conversations[0];
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
                              try {
                                sessionStorage.setItem(
                                  "chat-show-secondary-sidebar",
                                  "1",
                                );
                              } catch {
                                // ignore
                              }
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
                              <span className="max-w-[140px] min-w-0 flex-1 truncate text-sm group-data-[collapsible=icon]:hidden">
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
    <Avatar
      className={cn(
        "size-6 shrink-0 overflow-hidden rounded-full",
        modelId && "bg-white dark:bg-black",
      )}
    >
      {modelId ? (
        (() => {
          const modelImageUrls = getModelImageUrl(modelId);
          if (modelImageUrls) {
            const alt = modelName || t("modelAlt");
            return (
              <>
                <Image
                  src={modelImageUrls.light}
                  alt={alt}
                  width={32}
                  height={32}
                  className="block size-full object-contain p-0.5 dark:hidden"
                  onError={(e: SyntheticEvent<HTMLImageElement, Event>) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                <Image
                  src={modelImageUrls.dark}
                  alt={alt}
                  width={32}
                  height={32}
                  className="hidden size-full object-contain p-0.5 dark:block"
                  onError={(e: SyntheticEvent<HTMLImageElement, Event>) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </>
            );
          }
          return (
            <AvatarFallback
              className={cn(
                "bg-primary text-primary-foreground text-xs",
                isActive && "bg-primary-foreground text-primary",
              )}
            >
              {modelName ? modelName.charAt(0).toUpperCase() : "M"}
            </AvatarFallback>
          );
        })()
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
