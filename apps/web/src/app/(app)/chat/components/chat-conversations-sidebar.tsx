"use client";

import { Search, Trash2, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import {
  CHAT_APP_ROUTE_PREFIX,
  type ChatAppRoutePrefix,
} from "@/app/chat/utils/chat-route-base";
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
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConversationsContext } from "@/contexts/conversations-context";
import type { Conversation } from "@/lib/actions/conversation";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

const CONVERSATION_TITLE_MAX_CHARS = 50;
const MAX_QUERY_LENGTH = 256;

function truncateTitle(title: string, maxLength: number): string {
  if (title.length <= maxLength) return title;
  return title.slice(0, maxLength).trim() + "...";
}

interface ConversationsByDateGroup {
  key: string;
  conversations: Conversation[];
}

function buildConversationDayGroups(
  conversations: Conversation[],
  getDateGroupKey: (dateInput: Date | number) => string | null,
): ConversationsByDateGroup[] {
  const sorted = [...conversations].sort((a, b) => {
    const ta = new Date(a.updatedAt).getTime();
    const tb = new Date(b.updatedAt).getTime();
    return tb - ta;
  });
  const groupsMap = new Map<string, Conversation[]>();
  for (const conv of sorted) {
    const groupKey = getDateGroupKey(new Date(conv.updatedAt).getTime()) ?? "";
    const current = groupsMap.get(groupKey);
    if (current) {
      current.push(conv);
    } else {
      groupsMap.set(groupKey, [conv]);
    }
  }
  return Array.from(groupsMap, ([key, list]) => ({ key, conversations: list }));
}

interface ConversationRowProps {
  displayTitle: string;
  fullTitle: string;
  isTitleTruncated: boolean;
  isActive: boolean;
  formatTimeAgo: (date: Date | string) => string;
  updatedAt: Date | string;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent<HTMLButtonElement>) => void;
  deleteAriaLabel: string;
}

function ConversationRow({
  displayTitle,
  fullTitle,
  isTitleTruncated,
  isActive,
  formatTimeAgo,
  updatedAt,
  onSelect,
  onDelete,
  deleteAriaLabel,
}: ConversationRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) {
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "hover:bg-muted bg-muted/30 group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
        isActive && "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      <div className="min-w-0 flex-1">
        {isTitleTruncated ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className={cn(
                  "truncate text-sm font-medium",
                  isActive && "text-primary-foreground",
                )}
              >
                {displayTitle}
              </p>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs wrap-break-word">
              {fullTitle}
            </TooltipContent>
          </Tooltip>
        ) : (
          <p
            className={cn(
              "truncate text-sm font-medium",
              isActive && "text-primary-foreground",
            )}
          >
            {displayTitle}
          </p>
        )}
        <p
          className={cn(
            "text-muted-foreground truncate text-xs",
            isActive && "text-primary-foreground/80",
          )}
        >
          {formatTimeAgo(updatedAt)}
        </p>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete(e);
        }}
        aria-label={deleteAriaLabel}
        className={cn(
          "transition-opacity focus:opacity-100 focus:outline-none md:opacity-0 md:group-hover:opacity-100",
          "opacity-100",
          isActive
            ? "text-primary-foreground hover:bg-primary/20"
            : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
        )}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

interface ChatConversationsSidebarProps {
  /** URL prefix for this shell (always `/chat`). */
  chatRoutePrefix?: ChatAppRoutePrefix;
  bucket: string;
  bucketSlug: string;
  displayName: string;
  conversations: Conversation[];
}

export function ChatConversationsSidebar({
  chatRoutePrefix = CHAT_APP_ROUTE_PREFIX,
  bucket: _bucket,
  bucketSlug,
  displayName: _displayName,
  conversations,
}: ChatConversationsSidebarProps) {
  const t = useTranslations("App.Sidebar.Content.ChatLists");
  const tSearch = useTranslations("App.Chat.Chat.ConversationsSidebar");
  const { formatTimeAgo, getDateGroupKey } = useLocalizedDateTime();
  const router = useRouter();
  const params = useParams<{ conversationId?: string }>();
  const conversationId = params?.conversationId ?? null;
  const { deleteConversationById } = useConversationsContext();

  const basePath = chatRoutePrefix;
  const [searchValue, setSearchValue] = useState("");
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);

  const filteredConversations = useMemo(() => {
    const q = searchValue.trim().slice(0, MAX_QUERY_LENGTH);
    if (!q) return conversations;
    const lower = q.toLowerCase();
    return conversations.filter((c) => {
      const title =
        c.title ??
        (c.metadata as Record<string, string> | null)?.model_name ??
        (c.metadata as Record<string, string> | null)?.coworker_name ??
        "";
      return title.toLowerCase().includes(lower);
    });
  }, [conversations, searchValue]);

  const dayGroups = useMemo(
    () => buildConversationDayGroups(filteredConversations, getDateGroupKey),
    [filteredConversations, getDateGroupKey],
  );

  const handleConversationClick = useCallback(
    (convId: string) => {
      router.push(`${basePath}/${bucketSlug}/conversation/${convId}?open=1`, {
        scroll: false,
      });
    },
    [basePath, bucketSlug, router],
  );

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      setChatToDelete(id);
    },
    [],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!chatToDelete) return;
    const deletedId = chatToDelete;
    setChatToDelete(null);

    const isActive = conversationId === deletedId;
    const remaining = conversations.filter((c) => c.id !== deletedId);
    const sortedRemaining = [...remaining].sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      return tb - ta;
    });
    const nextId = sortedRemaining.length > 0 ? sortedRemaining[0].id : null;

    await deleteConversationById(deletedId);

    if (remaining.length === 0) {
      router.push(basePath, { scroll: false });
      return;
    }
    if (isActive) {
      if (nextId) {
        router.push(`${basePath}/${bucketSlug}/conversation/${nextId}`, {
          scroll: false,
        });
      } else {
        router.push(`${basePath}/${bucketSlug}`, { scroll: false });
      }
    }
  }, [
    basePath,
    bucketSlug,
    chatToDelete,
    conversationId,
    conversations,
    deleteConversationById,
    router,
  ]);

  return (
    <>
      <aside className="lg:border-border flex h-full min-h-0 w-full flex-col pt-20 pb-4 lg:w-72 lg:border-r lg:py-4">
        <div className="flex w-full flex-col items-start justify-between px-2 pb-2 md:flex-row md:items-center md:px-0 md:pr-4">
          <div className="flex w-full flex-col">
            <div className="relative w-full">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
              <Input
                className="pr-8 pl-8"
                placeholder={tSearch("searchPlaceholder")}
                value={searchValue}
                onChange={(e) =>
                  setSearchValue(e.target.value.slice(0, MAX_QUERY_LENGTH))
                }
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchValue("");
                }}
              />
              {searchValue ? (
                <button
                  type="button"
                  aria-label={tSearch("clearSearch")}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 transition outline-none"
                  onClick={() => setSearchValue("")}
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
          </div>
          {searchValue && (
            <div className="text-muted-foreground px-1 text-xs whitespace-nowrap md:text-sm">
              {tSearch("resultsCount", {
                found: filteredConversations.length,
                total: conversations.length,
              })}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-4 pb-24 md:p-2 md:pt-2 md:pr-4 md:pl-0 lg:pt-0 lg:pb-2">
          {dayGroups.length > 0 ? (
            dayGroups.map((group) => (
              <section key={group.key} className="mb-4">
                <div className="text-muted-foreground px-2 pb-2 text-xs font-medium capitalize">
                  {group.key}
                </div>
                <ul className="space-y-2">
                  {group.conversations.map((conv) => {
                    const isActive = conversationId === conv.id;
                    const title =
                      conv.title ??
                      (conv.metadata as Record<string, string> | null)
                        ?.model_name ??
                      (conv.metadata as Record<string, string> | null)
                        ?.coworker_name ??
                      t("untitledChat", { default: "Untitled Chat" });
                    const displayTitle = truncateTitle(
                      title,
                      CONVERSATION_TITLE_MAX_CHARS,
                    );
                    const isTitleTruncated =
                      title.length > CONVERSATION_TITLE_MAX_CHARS;
                    return (
                      <li key={conv.id}>
                        <ConversationRow
                          displayTitle={displayTitle}
                          fullTitle={title}
                          isTitleTruncated={isTitleTruncated}
                          isActive={isActive}
                          formatTimeAgo={formatTimeAgo}
                          updatedAt={conv.updatedAt}
                          onSelect={() => handleConversationClick(conv.id)}
                          onDelete={(e) => handleDeleteClick(e, conv.id)}
                          deleteAriaLabel={t("deleteChatAriaLabel")}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          ) : (
            <div className="text-muted-foreground px-2 py-8 text-sm">
              {searchValue ? tSearch("noResults") : tSearch("noConversations")}
            </div>
          )}
        </div>
      </aside>

      <AlertDialog
        open={chatToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setChatToDelete(null);
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
              className={buttonVariants({ variant: "destructive" })}
            >
              {t("deleteDialog.delete", { default: "Delete" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
