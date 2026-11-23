"use client";

import type { DataRoomQuestion, DataRoomTreeRow } from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFocusWhen } from "@/hooks/effects/use-focus-when";
import { useScrollIntoViewWhen } from "@/hooks/effects/use-scroll-into-view-when";
import { cn } from "@/lib/utils";
import {
  answerDataRoomQuestion,
  dataRoomRefusal,
  fetchDataRoomQuestions,
} from "@/lib/utils/data-room.client";
import type { FileStore } from "@/lib/utils/file-search.client";
import {
  cancelDriveQueries,
  driveQueryKeys,
  invalidateDrive,
  splitDriveQueryKey,
} from "@/queries/drive";
import { NEEDS_YOU_DATA_ROOM_QUESTIONS_QUERY_KEY } from "@/queries/needs-you-data-room-questions";
import { useScopedQuery } from "@/queries/scoped-queries";
import { rowLabel } from "./data-room-activity";

/** Viewers' questions about documents, each answerable in place. */
export function DataRoomQuestions({
  store,
  roomId,
  rows,
  focusQuestionId,
}: {
  store: FileStore;
  roomId: string;
  rows: DataRoomTreeRow[];
  /** The question Needs you opened the room on, ready to answer. */
  focusQuestionId?: string | null;
}) {
  const t = useTranslations("App.Drive.DataRoom.Questions");
  const queryClient = useQueryClient();
  const query = useScopedQuery({
    ...splitDriveQueryKey(driveQueryKeys.dataRoomQuestions(store, roomId)),
    queryFn: ({ signal }) => fetchDataRoomQuestions({ store, roomId, signal }),
  });

  if (query.isError)
    return (
      <p className="text-muted-foreground p-4 text-sm" role="alert">
        {t("loadFailed")}
      </p>
    );
  const questions = query.data ?? [];
  if (questions.length === 0)
    return (
      <p className={cn(HOLDER_ITEM_CLASS, "text-muted-foreground p-4 text-sm")}>
        {query.isPending ? t("loading") : t("empty")}
      </p>
    );
  return (
    <ul className="grid gap-2">
      {questions.map((question) => (
        <QuestionItem
          key={question.id}
          store={store}
          roomId={roomId}
          question={question}
          label={rowLabel(rows, question.path)}
          focused={question.id === focusQuestionId}
          onAnswered={async () => {
            await invalidateDrive(queryClient, store);
            // Needs you lists this question until it has an answer.
            void queryClient.invalidateQueries({
              queryKey: NEEDS_YOU_DATA_ROOM_QUESTIONS_QUERY_KEY,
            });
          }}
        />
      ))}
    </ul>
  );
}

function QuestionItem({
  store,
  roomId,
  question,
  label,
  focused,
  onAnswered,
}: {
  store: FileStore;
  roomId: string;
  question: DataRoomQuestion;
  label: string;
  focused: boolean;
  onAnswered: () => Promise<void>;
}) {
  const t = useTranslations("App.Drive.DataRoom.Questions");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState(question.answer ?? "");
  const [shared, setShared] = useState(question.sharedAt !== null);
  const [busy, setBusy] = useState(false);
  const shareHintId = useId();
  const answerRef = useRef<HTMLTextAreaElement>(null);

  // Opened from Needs you: bring the question into view with its answer box
  // ready, once, when it first renders.
  useScrollIntoViewWhen(answerRef, focused, { block: "center" });
  useFocusWhen(answerRef, focused, { preventScroll: true });

  return (
    <li
      className={cn(
        HOLDER_ITEM_CLASS,
        "grid gap-2 p-4",
        focused && "ring-ring ring-2",
      )}
    >
      <p className="text-muted-foreground text-xs">
        {t("byline", {
          who: question.name ?? question.email,
          path: label,
          when: format.relativeTime(new Date(question.createdAt)),
        })}
      </p>
      <p className="text-sm">{question.body}</p>
      <form
        className="grid gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!answer.trim()) return;
          setBusy(true);
          try {
            await cancelDriveQueries(queryClient, store);
            await answerDataRoomQuestion({
              store,
              roomId,
              questionId: question.id,
              answer,
              shared,
            });
            toast.success(shared ? t("answeredShared") : t("answered"));
            await onAnswered();
          } catch (error) {
            toast.error(dataRoomRefusal(error) ?? t("answerFailed"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Textarea
          ref={answerRef}
          rows={2}
          aria-label={t("answerLabel")}
          placeholder={t("answerPlaceholder")}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
        />
        <div className="grid gap-1">
          <Label className="flex min-h-6 items-center gap-2 font-normal">
            <Checkbox
              checked={shared}
              onCheckedChange={(checked) => setShared(checked === true)}
              aria-describedby={shareHintId}
            />
            {t("shareLabel")}
          </Label>
          <p id={shareHintId} className="text-muted-foreground text-xs">
            {t("shareHint")}
          </p>
        </div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="justify-self-start"
          loading={busy}
          disabled={
            !answer.trim() ||
            (answer === question.answer &&
              shared === (question.sharedAt !== null))
          }
        >
          {question.answer ? t("updateAnswer") : t("answer")}
        </Button>
      </form>
    </li>
  );
}
