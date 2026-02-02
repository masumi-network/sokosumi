"use client";

import { ChevronDown, MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths
import { useConversations } from "../../../chat/hooks/use-conversations";

export default function ChatListsClient() {
  const t = useTranslations("App.Sidebar.Content.ChatLists");
  const router = useRouter();
  const { open, isMobile, toggleSidebar } = useSidebar();
  const { conversations, refreshConversations, deleteConversationById } =
    useConversations();
  const searchParams = useSearchParams();
  const conversationId = searchParams?.get("conversationId");

  // Refresh conversations periodically to pick up new ones created elsewhere
  useEffect(() => {
    // Refresh immediately on mount
    void refreshConversations();

    // Set up interval to refresh every 2 seconds
    const interval = setInterval(() => {
      void refreshConversations();
    }, 2000);

    return () => clearInterval(interval);
  }, [refreshConversations]);

  const handleChatClick = () => {
    // Auto-collapse sidebar on desktop if it's expanded
    // On mobile, SheetClose already handles closing the Sheet
    if (!isMobile && open) {
      toggleSidebar();
    }
  };

  const handleDeleteChat = async (
    e: React.MouseEvent<HTMLButtonElement>,
    deletedConversationId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if the deleted chat is the currently active one
    const isActiveChat = conversationId === deletedConversationId;

    // If deleting the active chat, determine the next chat to navigate to BEFORE deletion
    let nextConversationId: string | null = null;
    if (isActiveChat) {
      // Get remaining conversations (excluding the one being deleted)
      const remainingConversations = conversations.filter(
        (conv) => conv.id !== deletedConversationId,
      );

      // Sort remaining conversations by updatedAt descending
      const sortedRemaining = [...remainingConversations].sort((a, b) => {
        const dateA = new Date(a.updatedAt).getTime();
        const dateB = new Date(b.updatedAt).getTime();
        return dateB - dateA;
      });

      // Get the first remaining conversation ID, or null if none
      nextConversationId =
        sortedRemaining.length > 0 ? sortedRemaining[0].id : null;
    }

    // Delete the conversation
    await deleteConversationById(deletedConversationId);

    // If we deleted the active chat, navigate to next chat or /chat
    if (isActiveChat) {
      if (nextConversationId) {
        router.push(`/chat?conversationId=${nextConversationId}`);
      } else {
        router.push("/chat");
      }
    }
  };

  // Sort conversations by updatedAt descending
  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const dateA = new Date(a.updatedAt).getTime();
      const dateB = new Date(b.updatedAt).getTime();
      return dateB - dateA;
    });
  }, [conversations]);

  return (
    <Collapsible
      defaultOpen={sortedConversations.length > 0}
      className="group/collapsible"
    >
      <SidebarGroup className="w-72 md:w-64">
        <SidebarGroupLabel
          className="text-primary text-sm group-data-[collapsible=icon]:hidden"
          asChild
        >
          <CollapsibleTrigger>
            <MessageSquare className="mr-2 size-4" aria-hidden />
            {t("title", { default: "Chats" })}
            <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <span className="text-primary preserve-aspect-ratio-[xMidYMid_meet] hidden p-2 transition-all duration-200 group-data-[collapsible=icon]:block group-data-[collapsible=icon]:pl-3!">
          <MessageSquare className="mr-2 size-4" aria-hidden />
        </span>
        <CollapsibleContent>
          <SidebarGroupContent className="mt-2">
            {sortedConversations.length > 0 ? (
              <SidebarMenu>
                {sortedConversations.map((conversation) => {
                  const isActive = conversationId === conversation.id;
                  const metadata = conversation.metadata as {
                    coworker_name?: string;
                    coworker_id?: string;
                  } | null;
                  const coworkerName = metadata?.coworker_name;
                  const coworkerId = metadata?.coworker_id;
                  const displayName =
                    conversation.title ||
                    coworkerName ||
                    t("untitledChat", { default: "Untitled Chat" });

                  return (
                    <SidebarMenuItem key={conversation.id}>
                      <SidebarMenuButton
                        asChild
                        className={cn(
                          "group/chat-item relative px-4 py-5 group-data-[collapsible=icon]:px-2",
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
                            href={`/chat?conversationId=${conversation.id}`}
                            onClick={handleChatClick}
                          >
                            <div className="group/chat-menu flex w-full items-center justify-start gap-2 group-data-[collapsible=icon]:justify-center">
                              <Avatar className="size-6 shrink-0">
                                {coworkerId &&
                                  (() => {
                                    const imageMap: Record<string, string> = {
                                      hannah: "/images/coworkers/hannah.png",
                                      demosthenes:
                                        "/images/coworkers/demosthenes.png",
                                    };
                                    const imageUrl = imageMap[coworkerId];
                                    return imageUrl ? (
                                      <AvatarImage
                                        src={imageUrl}
                                        alt={coworkerName || "Coworker"}
                                        onError={(
                                          e: React.SyntheticEvent<
                                            HTMLImageElement,
                                            Event
                                          >,
                                        ) => {
                                          e.currentTarget.style.display =
                                            "none";
                                        }}
                                      />
                                    ) : null;
                                  })()}
                                <AvatarFallback
                                  className={cn(
                                    "bg-primary text-primary-foreground text-xs",
                                    isActive &&
                                      "bg-primary-foreground text-primary",
                                  )}
                                >
                                  {coworkerName ? coworkerName.charAt(0) : "C"}
                                </AvatarFallback>
                              </Avatar>
                              <span className="flex-1 truncate text-sm group-data-[collapsible=icon]:hidden">
                                {displayName}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  "invisible h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover/chat-item:visible group-hover/chat-item:opacity-100 group-data-[collapsible=icon]:hidden",
                                  {
                                    "text-primary-foreground hover:text-primary-foreground hover:bg-primary/20":
                                      isActive,
                                    "text-muted-foreground hover:text-destructive hover:bg-destructive/10":
                                      !isActive,
                                  },
                                )}
                                onClick={(e) =>
                                  handleDeleteChat(e, conversation.id)
                                }
                                aria-label="Delete chat"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
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
