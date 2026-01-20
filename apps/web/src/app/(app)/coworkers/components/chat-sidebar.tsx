"use client";

import { CircleDot, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type ChatStatus = "active" | "awaiting" | "resolved";

export interface Coworker {
  id: string;
  name: string;
  avatar?: string;
  description: string;
  useCase: string;
}

interface Chat {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessage?: string;
  lastMessageTime?: Date;
  status: ChatStatus;
  coworker?: Coworker;
  unreadCount?: number;
}

interface ChatSidebarProps {
  chats: Chat[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string | null) => void;
  onDeleteChat: (chatId: string) => void;
  onCreateNewChat: () => void;
}

export default function ChatSidebar({
  chats,
  selectedChatId,
  onSelectChat,
  onCreateNewChat,
  onDeleteChat,
}: ChatSidebarProps) {
  const t = useTranslations("App.Coworkers.Chat");
  const formatter = useFormatter();
  const [filter, setFilter] = useState<"all" | "awaiting">("all");
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);


  const filteredChats =
    filter === "all"
      ? chats
      : chats.filter((chat) => chat.status === filter);

  // Calculate counts for each filter
  const allCount = chats.length;
  const awaitingCount = chats.filter((c) => c.status === "awaiting").length;

  const getStatusBadge = (status: ChatStatus) => {
    // Only show badge for "awaiting" status
    if (status === "awaiting") {
      return (
        <Badge
          variant="default"
          className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
        >
          {t("statusAwaiting")}
        </Badge>
      );
    }
    return null;
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("justNow");
    if (diffMins < 60) return t("minutesAgo", { count: diffMins });
    if (diffHours < 24) return t("hoursAgo", { count: diffHours });
    return t("daysAgo", { count: diffDays });
  };

  const pruneMessage = (message: string, maxLength: number = 50) => {
    if (message.length <= maxLength) return message;
    return message.slice(0, maxLength) + "...";
  };

  const formatLastMessageTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("justNow");
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return `${diffDays}d`;
  };

  return (
    <div className="flex h-full flex-col border-r bg-card">
      <div className="border-b p-4">
        <Button
          onClick={onCreateNewChat}
          className="w-full"
          variant="primary"
          size="default"
        >
          <Plus className="size-4" />
          {t("newChat")}
        </Button>
      </div>
      <div className="border-b">
        <div className="flex">
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors whitespace-nowrap",
              filter === "all"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t("filterAll")} ({allCount})
          </button>
          <button
            onClick={() => setFilter("awaiting")}
            className={cn(
              "flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors whitespace-nowrap",
              filter === "awaiting"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t("filterAwaiting")} ({awaitingCount})
          </button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2">
          {filteredChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <MessageSquare className="text-muted-foreground mb-2 size-8" />
              <p className="text-muted-foreground text-sm">
                {t("noChats")}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredChats.map((chat) => (
                <div
                  key={chat.id}
                  className={cn(
                    "group relative flex flex-col gap-2 rounded-md px-3 py-3 text-sm transition-colors hover:bg-accent min-w-0 max-w-full overflow-hidden",
                    selectedChatId === chat.id &&
                      "bg-accent text-accent-foreground",
                  )}
                >
                  <button
                    onClick={() => onSelectChat(chat.id)}
                    className="flex flex-1 flex-col gap-1.5 text-left w-full min-w-0 max-w-full"
                  >
                    <div className="flex items-start justify-between gap-2 w-full min-w-0 max-w-full">
                      <div className="flex-1 min-w-0 max-w-full flex items-start gap-2 overflow-hidden">
                        {chat.coworker && (
                          <Avatar className="size-8 shrink-0">
                            <AvatarFallback className="bg-primary text-primary-foreground">
                              {chat.coworker.name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className="flex-1 min-w-0 max-w-full overflow-hidden">
                          <div className="flex items-center gap-1.5 min-w-0 max-w-full">
                            <div className="font-medium truncate text-sm min-w-0 max-w-full">
                              {chat.coworker?.name || chat.title}
                            </div>
                            {chat.lastMessageTime && (
                              <>
                                <span className="text-muted-foreground text-[10px] shrink-0">•</span>
                                <span className="text-muted-foreground text-[10px] shrink-0 whitespace-nowrap">
                                  {formatLastMessageTime(chat.lastMessageTime)}
                                </span>
                              </>
                            )}
                          </div>
                          {chat.lastMessage && (
                            <div className="text-muted-foreground text-xs mt-0.5 truncate overflow-hidden text-ellipsis whitespace-nowrap max-w-full">
                              {pruneMessage(chat.lastMessage, 25)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {chat.unreadCount !== undefined && chat.unreadCount > 0 && (
                          <CircleDot className="size-4 text-primary" fill="currentColor" />
                        )}
                        {getStatusBadge(chat.status)}
                      </div>
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      setChatToDelete(chat.id);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
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
            <AlertDialogTitle>{t("deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setChatToDelete(null)}>
              {t("deleteDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (chatToDelete) {
                  onDeleteChat(chatToDelete);
                  setChatToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("deleteDialog.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
