"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClipboard } from "@/hooks/use-clipboard";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { fetchDataRoom } from "@/lib/utils/data-room.client";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import type { FileStore } from "@/lib/utils/file-search.client";
import { DataRoomActivity } from "./data-room-activity";
import { DataRoomColleagues } from "./data-room-colleagues";
import { DataRoomContents } from "./data-room-contents";
import { DataRoomPeople } from "./data-room-people";
import { DataRoomQuestions } from "./data-room-questions";
import { DataRoomSettingsPanel } from "./data-room-settings";

export function DataRoomClient({ roomId }: { roomId: string }) {
  const t = useTranslations("App.Drive.DataRoom");
  const { data: session } = useSession();
  const store: FileStore = driveStoreForActiveWorkspace(
    session?.session?.activeOrganizationId ?? null,
  );
  const query = useQuery({
    queryKey: ["drive", "data-room", roomId, store],
    queryFn: () => fetchDataRoom({ store, roomId }),
    enabled: Boolean(session),
  });
  const { copied, copy } = useClipboard({
    copySuccessMessage: t("linkCopied"),
    copyErrorMessage: t("linkCopyFailed"),
  });

  if (query.isError)
    return (
      <p className="text-muted-foreground p-4 text-sm" role="alert">
        {t("loadFailed")}
      </p>
    );
  if (!query.data)
    return (
      <div className="grid gap-3 p-4" role="status">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  const { room, members, rows, colleagues, canChooseColleagues } = query.data;
  const name =
    room.title ?? room.folderPath.split("/").at(-1) ?? room.folderPath;
  const link =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/share/rooms/${encodeURIComponent(room.token)}`;
  const refresh = () => void query.refetch();

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <header className="flex min-w-0 flex-wrap items-center gap-3">
        <Button
          asChild
          variant="ghost"
          size="icon"
          aria-label={t("backToFiles")}
        >
          <Link
            href={`/drive?view=workspace&folder=${encodeURIComponent(room.folderPath)}`}
          >
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <LockKeyhole aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{name}</h1>
          <p className="text-muted-foreground truncate text-sm">
            {t(`storage.${room.storage}`)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!link}
          onClick={() => void copy(link)}
        >
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          {t("copyLink")}
        </Button>
      </header>

      <Tabs defaultValue="people" className="gap-3">
        <TabsList>
          <TabsTrigger value="people">
            {t("tabs.people", {
              count: members.filter((m) => !m.revokedAt).length,
            })}
          </TabsTrigger>
          <TabsTrigger value="activity">{t("tabs.activity")}</TabsTrigger>
          <TabsTrigger value="questions">{t("tabs.questions")}</TabsTrigger>
          <TabsTrigger value="contents">{t("tabs.contents")}</TabsTrigger>
          <TabsTrigger value="settings">{t("tabs.settings")}</TabsTrigger>
        </TabsList>
        <div className={cn(HOLDER_CLASS, "grid gap-2")}>
          <TabsContent value="people" className="grid gap-2">
            {store.scope === "org" && store.organizationId && colleagues ? (
              <DataRoomColleagues
                store={store}
                organizationId={store.organizationId}
                roomId={room.id}
                makerId={room.createdByUserId}
                colleagues={colleagues}
                canChoose={canChooseColleagues}
                onChanged={refresh}
              />
            ) : null}
            <DataRoomPeople
              store={store}
              roomId={room.id}
              members={members}
              rows={rows}
              onChanged={refresh}
            />
          </TabsContent>
          <TabsContent value="activity">
            <DataRoomActivity
              store={store}
              roomId={room.id}
              members={members}
              rows={rows}
            />
          </TabsContent>
          <TabsContent value="questions">
            <DataRoomQuestions store={store} roomId={room.id} rows={rows} />
          </TabsContent>
          <TabsContent value="contents">
            <DataRoomContents
              store={store}
              roomId={room.id}
              rows={rows}
              onChanged={refresh}
            />
          </TabsContent>
          <TabsContent value="settings">
            <DataRoomSettingsPanel
              store={store}
              room={room}
              rows={rows}
              onChanged={refresh}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
