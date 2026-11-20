"use client";

import type { DiscoverableChatRoom } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { List, Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import {
  joinRoomAction,
  listDiscoverableChannelsAction,
} from "@/app/chat/actions";
import { ChannelDiscoverabilityIcon } from "@/components/chat/channel-discoverability-icon";
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

export function BrowseChannelsDialog({
  triggerClassName,
}: {
  triggerClassName?: string;
}) {
  const t = useTranslations("App.Channels.Browse");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, 200);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [_isJoining, startJoinTransition] = useTransition();

  const effectiveQuery = query === "" ? "" : debouncedQuery;
  const channelsQuery = useQuery({
    queryKey: ["chat", "discoverable-channels", effectiveQuery],
    queryFn: async () => {
      const result = await listDiscoverableChannelsAction({
        q: effectiveQuery,
      });
      if (!result.ok) {
        const message = result.error.message || t("loadError");
        toast.error(message);
        throw new Error(message);
      }
      return result.value;
    },
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const rooms = open ? (channelsQuery.data ?? []) : [];
  const isLoading = open && channelsQuery.isFetching;

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setJoiningRoomId(null);
    }
  }

  function handleJoin(room: DiscoverableChatRoom) {
    if (joiningRoomId) {
      return;
    }
    setJoiningRoomId(room.id);
    startJoinTransition(async () => {
      const result = await joinRoomAction(room.id);
      setJoiningRoomId(null);
      if (!result.ok) {
        toast.error(result.error.message || t("joinError"));
        return;
      }
      toast.success(t("joinSuccess", { name: result.value.name }));
      notifyOrganizationChatRoomsChanged({
        room: result.value,
        joinedRoomId: result.value.id,
      });
      setOpen(false);
      // Soft router navigation from this Dialog + useTransition path does not
      // commit; hard assign reliably opens the joined room.
      window.location.assign(`/chat/rooms/${result.value.id}`);
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
            "text-muted-foreground press hover:bg-sidebar-accent hover:text-sidebar-accent-foreground relative size-8 rounded-md after:absolute after:-inset-1.5 md:size-7 md:after:-inset-0.5"
          }
          aria-label={t("trigger")}
          title={t("trigger")}
        >
          <List className="size-5 md:size-3.5" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden shadow-none sm:max-w-lg">
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
            className="h-10 pl-9"
            aria-label={t("searchPlaceholder")}
          />
        </div>
        <ScrollArea className="h-[min(24rem,50dvh)]">
          {isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 px-4 py-12 text-sm">
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-pulse"
                aria-hidden
              />
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
                    className="press hover:bg-accent transition-colors flex items-start gap-3 rounded-md px-3 py-2.5"
                  >
                    <ChannelDiscoverabilityIcon
                      discoverability={room.discoverability}
                      className="text-muted-foreground mt-0.5 size-4 shrink-0"
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
                      loading={isJoining}
                      onClick={() => handleJoin(room)}
                    >
                      {t("join")}
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
