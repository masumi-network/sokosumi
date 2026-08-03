"use client";

import { Compass, Hash, Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  joinRoomAction,
  listBrowsableChannelsAction,
} from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BrowsableChatRoom } from "@/lib/clients/generated/core";

export function BrowseChannelsDialog({
  triggerClassName,
}: {
  triggerClassName?: string;
}) {
  const t = useTranslations("App.Channels.Browse");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rooms, setRooms] = useState<BrowsableChatRoom[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [_isJoining, startJoinTransition] = useTransition();

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);
      const result = await listBrowsableChannelsAction({ q: query });
      if (cancelled) {
        return;
      }
      setIsLoading(false);
      if (!result.ok) {
        toast.error(result.message || t("loadError"));
        setRooms([]);
        return;
      }
      setRooms(result.data);
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [open, query, t]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setRooms([]);
      setJoiningRoomId(null);
    }
  }

  function handleJoin(room: BrowsableChatRoom) {
    if (joiningRoomId) {
      return;
    }
    setJoiningRoomId(room.id);
    startJoinTransition(async () => {
      const result = await joinRoomAction(room.id);
      setJoiningRoomId(null);
      if (!result.ok) {
        toast.error(result.message || t("joinError"));
        return;
      }
      toast.success(t("joinSuccess", { name: result.data.name }));
      notifyOrganizationChatRoomsChanged(result.data);
      setOpen(false);
      window.location.assign(`/chat/rooms/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={
            triggerClassName ??
            "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground size-7 rounded-md"
          }
          aria-label={t("trigger")}
          title={t("trigger")}
        >
          <Compass className="size-3.5" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-hidden shadow-none sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 pl-9"
            aria-label={t("searchPlaceholder")}
          />
        </div>
        <ScrollArea className="h-[min(24rem,50svh)]">
          {isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 px-4 py-12 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("loading")}
            </div>
          ) : rooms.length === 0 ? (
            <div className="text-muted-foreground px-4 py-12 text-center text-sm">
              {t("empty")}
            </div>
          ) : (
            <ul className="space-y-1 p-1">
              {rooms.map((room) => {
                const isJoining = joiningRoomId === room.id;
                return (
                  <li
                    key={room.id}
                    className="hover:bg-muted/50 flex items-start gap-3 rounded-md px-3 py-2.5"
                  >
                    <Hash
                      className="text-muted-foreground mt-0.5 size-4 shrink-0"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {room.name}
                      </p>
                      {room.topic ? (
                        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                          {room.topic}
                        </p>
                      ) : null}
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t("memberCount", { count: room.memberCount })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2.5 text-xs"
                      disabled={joiningRoomId !== null}
                      onClick={() => handleJoin(room)}
                    >
                      {isJoining ? (
                        <Loader2
                          className="size-3.5 animate-spin"
                          aria-hidden
                        />
                      ) : (
                        t("join")
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
