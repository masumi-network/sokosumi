"use client";

import type { DataRoomEvent, DataRoomMember } from "@sokosumi/core-client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fetchDataRoomEvents } from "@/lib/utils/data-room.client";
import type { FileStore } from "@/lib/utils/file-search.client";

const EVERYONE = "everyone";

/** Who came in and what they opened, newest first. */
export function DataRoomActivity({
  store,
  roomId,
  members,
}: {
  store: FileStore;
  roomId: string;
  members: DataRoomMember[];
}) {
  const t = useTranslations("App.Drive.DataRoom.Activity");
  const format = useFormatter();
  const [memberId, setMemberId] = useState(EVERYONE);
  const query = useInfiniteQuery({
    queryKey: ["drive", "data-room", roomId, "events", memberId, store],
    queryFn: ({ pageParam }) =>
      fetchDataRoomEvents({
        store,
        roomId,
        ...(memberId === EVERYONE ? {} : { memberId }),
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextBefore ?? undefined,
  });
  const events = query.data?.pages.flatMap((page) => page.events) ?? [];

  function describe(event: DataRoomEvent): string {
    const who = event.name ?? event.email ?? t("someone");
    const what = event.path ?? "";
    return t(`kind.${event.kind}`, { who, what });
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Select value={memberId} onValueChange={setMemberId}>
          <SelectTrigger className="w-64" aria-label={t("filterLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EVERYONE}>{t("everyone")}</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.name ?? member.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {query.isError ? (
        <p className="text-muted-foreground p-4 text-sm" role="alert">
          {t("loadFailed")}
        </p>
      ) : events.length === 0 ? (
        <p
          className={cn(HOLDER_ITEM_CLASS, "text-muted-foreground p-4 text-sm")}
        >
          {query.isPending ? t("loading") : t("empty")}
        </p>
      ) : (
        <ul className={cn(HOLDER_ITEM_CLASS, "divide-border divide-y")}>
          {events.map((event) => (
            <li
              key={event.id}
              className="flex min-w-0 items-center gap-3 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{describe(event)}</span>
              <time
                dateTime={event.createdAt}
                className="text-muted-foreground shrink-0 text-xs tabular-nums"
              >
                {format.dateTime(new Date(event.createdAt), "dateTimeMedium")}
              </time>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-center"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("more")}
        </Button>
      ) : null}
    </div>
  );
}
