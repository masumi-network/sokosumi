"use client";

import type {
  DataRoomQuestion,
  DataRoomTreeRow,
  DataRoomView,
} from "@sokosumi/core-client";
import { Download, File, Folder, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils/format-bytes";
import { RoomMark } from "./room-mark";
import { RoomPdf } from "./room-pdf";

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** A signed-in viewer's room: the numbered index, one file open beside it. */
export function RoomViewer({
  token,
  room,
}: {
  token: string;
  room: DataRoomView;
}) {
  const t = useTranslations("Share.Room");
  const router = useRouter();
  const base = `/share/rooms/${encodeURIComponent(token)}`;
  const firstFile = room.rows.find((row) => row.kind === "file") ?? null;
  const [openPath, setOpenPath] = useState<string | null>(
    firstFile?.path ?? null,
  );
  const open = room.rows.find((row) => row.path === openPath) ?? null;

  return (
    <div className="flex w-full flex-col gap-4 p-4 md:px-8 md:py-6">
      <header className="flex min-w-0 flex-wrap items-center gap-3">
        <RoomMark token={token} hasLogo={room.hasLogo} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{room.title}</h1>
          <p className="text-muted-foreground truncate text-sm">
            {t("signedInAs", { email: room.viewer?.email ?? "" })}
          </p>
        </div>
        {room.allowDownload && room.rows.length > 0 ? (
          <Button asChild variant="outline" size="sm">
            <a href={`${base}/zip`}>
              <Download aria-hidden className="size-4" />
              {t("downloadAll")}
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={async () => {
            await fetch(`${base}/signout`, { method: "POST" });
            router.refresh();
          }}
        >
          <LogOut aria-hidden className="size-4" />
          {t("signOut")}
        </Button>
      </header>

      {room.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(16rem,22rem)_1fr]">
          <nav aria-label={t("indexLabel")} className="min-w-0">
            <ul className="divide-border divide-y rounded-lg border">
              {room.rows.map((row) => (
                <RoomRow
                  key={row.path}
                  row={row}
                  active={row.path === openPath}
                  onOpen={() => setOpenPath(row.path)}
                />
              ))}
            </ul>
          </nav>
          <section className="min-w-0" aria-live="polite">
            {open?.kind === "file" && open.resourceId ? (
              <RoomFile
                key={open.resourceId}
                base={base}
                row={open}
                allowDownload={room.allowDownload}
                watermark={room.watermark}
              />
            ) : (
              <p className="text-muted-foreground text-sm">{t("pickFile")}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function RoomRow({
  row,
  active,
  onOpen,
}: {
  row: DataRoomTreeRow;
  active: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("Share.Room");
  const Icon = row.kind === "folder" ? Folder : File;
  const content = (
    <>
      <span className="text-muted-foreground w-10 shrink-0 text-xs tabular-nums">
        {row.number}
      </span>
      <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
      {row.isNew ? (
        <span className="bg-muted shrink-0 rounded px-1.5 text-2xs font-medium">
          {t("new")}
        </span>
      ) : null}
    </>
  );
  const indent = { paddingInlineStart: `${12 + row.depth * 16}px` };
  if (row.kind === "folder")
    return (
      <li className="flex min-w-0 items-center gap-2 py-2 pe-3" style={indent}>
        {content}
      </li>
    );
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active || undefined}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 py-2 pe-3 text-left",
          active ? "bg-muted" : "hover:bg-quinary",
        )}
        style={indent}
      >
        {content}
      </button>
    </li>
  );
}

function RoomFile({
  base,
  row,
  allowDownload,
  watermark,
}: {
  base: string;
  row: DataRoomTreeRow;
  allowDownload: boolean;
  watermark: boolean;
}) {
  const t = useTranslations("Share.Room");
  const url = `${base}/files/${encodeURIComponent(row.resourceId ?? "")}`;
  const mime = row.mimeType ?? "";

  return (
    <div className="grid gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">
            <span className="text-muted-foreground me-2 tabular-nums">
              {row.number}
            </span>
            {row.name}
          </h2>
          {row.sizeBytes !== null ? (
            <p className="text-muted-foreground text-xs tabular-nums">
              {formatBytes(row.sizeBytes)}
            </p>
          ) : null}
        </div>
        {allowDownload ? (
          <Button asChild variant="outline" size="sm">
            <a href={`${url}?download=true`}>
              <Download aria-hidden className="size-4" />
              {t("download")}
            </a>
          </Button>
        ) : null}
      </div>
      {watermark ? (
        <p className="text-muted-foreground text-xs">{t("watermarkNote")}</p>
      ) : null}

      {mime === "application/pdf" ? (
        <RoomPdf url={url} />
      ) : IMAGE_TYPES.has(mime) ? (
        <img
          src={url}
          alt={row.name}
          className="max-w-full rounded-md border"
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          {allowDownload ? t("downloadToOpen") : t("cannotOpenHere")}
        </p>
      )}

      <RoomQuestions base={base} resourceId={row.resourceId ?? ""} />
    </div>
  );
}

function RoomQuestions({
  base,
  resourceId,
}: {
  base: string;
  resourceId: string;
}) {
  const t = useTranslations("Share.Room");
  const questionId = useId();
  const [questions, setQuestions] = useState<DataRoomQuestion[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    fetch(`${base}/questions?resourceId=${encodeURIComponent(resourceId)}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((loaded: DataRoomQuestion[]) => {
        if (current) setQuestions(loaded);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [base, resourceId]);

  return (
    <div className="grid gap-3 border-t pt-4">
      <h3 className="text-sm font-medium">{t("questionsTitle")}</h3>
      {questions.length > 0 ? (
        <ul className="grid gap-3">
          {questions.map((question) => (
            <li key={question.id} className="grid gap-1 text-sm">
              <p>{question.body}</p>
              <p className="text-muted-foreground">
                {question.answer ?? t("awaitingAnswer")}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="grid gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!body.trim()) return;
          setBusy(true);
          setFailed(false);
          try {
            const response = await fetch(`${base}/questions`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ resourceId, body }),
            });
            if (!response.ok) throw new Error("ask failed");
            const asked = (await response.json()) as DataRoomQuestion;
            setQuestions((previous) => [asked, ...previous]);
            setBody("");
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Label htmlFor={questionId}>{t("askLabel")}</Label>
        <Textarea
          id={questionId}
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        {failed ? (
          <p role="alert" className="text-semantic-destructive text-sm">
            {t("askFailed")}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="justify-self-start"
          loading={busy}
          disabled={!body.trim()}
        >
          {t("ask")}
        </Button>
      </form>
    </div>
  );
}
