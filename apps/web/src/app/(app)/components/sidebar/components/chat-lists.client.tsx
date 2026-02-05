"use client";

import { ChevronDown, MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { useConversations } from "@/app/chat/hooks/use-conversations";
import { getModelImageUrl } from "@/app/chat/utils/model-utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

// Helper function to truncate names longer than 12 characters
function truncateName(name: string, maxLength: number = 12): string {
  if (name.length <= maxLength) return name;
  return name.slice(0, maxLength) + "...";
}

export default function ChatListsClient() {
  const t = useTranslations("App.Sidebar.Content.ChatLists");
  const router = useRouter();
  const { open, isMobile, toggleSidebar } = useSidebar();
  const { conversations, refreshConversations, deleteConversationById } =
    useConversations();
  const searchParams = useSearchParams();
  const conversationId = searchParams?.get("conversationId");
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);

  // Refresh conversations on mount and when conversations count changes
  // Note: Further refreshes happen automatically via:
  // - Visibility change handler in use-conversations hook
  // - After user actions (create, delete, etc.) in use-conversations hook
  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Also refresh when URL conversationId changes (user navigates to a conversation or creates a new one)
  // This ensures the sidebar is up-to-date when switching conversations or when a new conversation is created
  // Add a small delay to ensure the server has processed the creation
  useEffect(() => {
    if (conversationId) {
      const timeoutId = setTimeout(() => {
        void refreshConversations();
      }, 500); // Small delay to ensure server has processed the creation
      return () => clearTimeout(timeoutId);
    }
  }, [conversationId, refreshConversations]);

  const handleChatClick = () => {
    // Auto-collapse sidebar on desktop if it's expanded
    // On mobile, SheetClose already handles closing the Sheet
    if (!isMobile && open) {
      toggleSidebar();
    }
  };

  const handleDeleteClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    deletedConversationId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setChatToDelete(deletedConversationId);
  };

  const handleConfirmDelete = async () => {
    if (!chatToDelete) return;

    const deletedConversationId = chatToDelete;
    setChatToDelete(null);

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
                    model_id?: string;
                    model_name?: string;
                  } | null;
                  const coworkerName = metadata?.coworker_name;
                  const coworkerId = metadata?.coworker_id;
                  const modelId = metadata?.model_id;
                  const modelName = metadata?.model_name;
                  const rawDisplayName =
                    conversation.title ||
                    coworkerName ||
                    modelName ||
                    t("untitledChat", { default: "Untitled Chat" });
                  // Truncate display name to prevent sidebar overflow
                  const displayName = truncateName(rawDisplayName, 20);

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
                              <Avatar
                                className={cn(
                                  "size-6 shrink-0 overflow-hidden rounded-full",
                                  modelId && "bg-white dark:bg-black",
                                )}
                              >
                                {(() => {
                                  // If it's a model conversation, show model logo
                                  if (modelId) {
                                    const modelImageUrls =
                                      getModelImageUrl(modelId);
                                    if (modelImageUrls) {
                                      return (
                                        <>
                                          <img
                                            src={modelImageUrls.light}
                                            alt={modelName || "Model"}
                                            className="block size-full object-contain p-0.5 dark:hidden"
                                            onError={(e) => {
                                              e.currentTarget.style.display =
                                                "none";
                                            }}
                                          />
                                          <img
                                            src={modelImageUrls.dark}
                                            alt={modelName || "Model"}
                                            className="hidden size-full object-contain p-0.5 dark:block"
                                            onError={(e) => {
                                              e.currentTarget.style.display =
                                                "none";
                                            }}
                                          />
                                        </>
                                      );
                                    }
                                    // Fallback to model name initial
                                    return (
                                      <AvatarFallback
                                        className={cn(
                                          "bg-primary text-primary-foreground text-xs",
                                          isActive &&
                                            "bg-primary-foreground text-primary",
                                        )}
                                      >
                                        {modelName
                                          ? modelName.charAt(0).toUpperCase()
                                          : "M"}
                                      </AvatarFallback>
                                    );
                                  }

                                  // If it's a coworker conversation, show coworker image
                                  if (coworkerId) {
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
                                  }

                                  // Default fallback
                                  return (
                                    <AvatarFallback
                                      className={cn(
                                        "bg-primary text-primary-foreground text-xs",
                                        isActive &&
                                          "bg-primary-foreground text-primary",
                                      )}
                                    >
                                      {coworkerName
                                        ? coworkerName.charAt(0)
                                        : modelName
                                          ? modelName.charAt(0).toUpperCase()
                                          : "C"}
                                    </AvatarFallback>
                                  );
                                })()}
                              </Avatar>
                              <span className="max-w-[140px] min-w-0 flex-1 truncate text-sm group-data-[collapsible=icon]:hidden">
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
                                  handleDeleteClick(e, conversation.id)
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
      <AlertDialog
        open={chatToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setChatToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deleteDialog.title", { default: "Delete Chat" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDialog.description", {
                default:
                  "Are you sure you want to delete this chat? This action cannot be undone.",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setChatToDelete(null)}>
              {t("deleteDialog.cancel", { default: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("deleteDialog.delete", { default: "Delete" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Collapsible>
  );
}
