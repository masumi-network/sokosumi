"use client";

import { Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { type ComponentProps, use, useMemo, useRef, useState } from "react";
import type { Components } from "react-markdown";
import { toast } from "sonner";
import {
  finishTableCopy,
  type TableCopy,
  tableCopyRows,
} from "@/app/drive/tables/table-copy";
import { MarkdownTable } from "@/components/markdown";
import { MarkdownClippedContext } from "@/components/markdown-clipped-context";
import { Button } from "@/components/ui/button";
import {
  TaskResultTableTooLarge,
  taskResultTablePlan,
} from "./task-result-table";

/** The Task a saved Table comes from: its name titles the Table, and the Table joins its project. */
type Source = { title: string; projectId: string | null };

/** The toasts carry the way to the new Table or how to finish it: they stay until dismissed. */
const STAY = { duration: Infinity, closeButton: true };

function SaveableTable({
  source,
  ...props
}: ComponentProps<typeof MarkdownTable> & { source: Source }) {
  const t = useTranslations("App.Tasks.Detail.saveTable");
  const format = useFormatter();
  const router = useRouter();
  const table = useRef<HTMLTableElement>(null);
  const copy = useRef<TableCopy | null>(null);
  const [pending, setPending] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const clipped = use(MarkdownClippedContext);

  async function save() {
    if (!table.current) return;
    setPending(true);
    try {
      // The cells as the reader sees them; a failed save keeps its plan and finishes on the next press.
      copy.current ??= {
        done: 0,
        plan: taskResultTablePlan(
          Array.from(table.current.querySelectorAll("tr"), (row) =>
            Array.from(
              row.querySelectorAll("th, td"),
              (cell) => cell.textContent ?? "",
            ),
          ),
          {
            title: t("title", { task: source.title }),
            description: t("description", {
              task: source.title,
              date: format.dateTime(new Date(), { dateStyle: "medium" }),
            }),
            projectId: source.projectId,
          },
          (position) => t("untitledColumn", { position }),
          crypto.randomUUID(),
        ),
      };
      const id = await finishTableCopy(copy.current);
      const { total } = tableCopyRows(copy.current);
      copy.current = null;
      setSavedId(id);
      toast.success(t("saved", { count: total }), {
        ...STAY,
        action: {
          label: t("open"),
          onClick: () => router.push(`/drive/tables/${id}`),
        },
      });
    } catch (error) {
      if (error instanceof TaskResultTableTooLarge) {
        toast.error(t("tooLarge"), STAY);
        return;
      }
      const rows = copy.current && tableCopyRows(copy.current);
      toast.error(rows?.saved ? t("partial", rows) : t("failed"), STAY);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <MarkdownTable ref={table} {...props} />
      {/* Below the clamp the action would take focus and clicks while nobody can see it, so it turns
      inert there. It keeps its place: removing it would change the height the clamp is measured on. */}
      <div
        data-table-action
        inert={clipped}
        className="not-prose -mt-1.5 mb-3 flex justify-end"
      >
        {savedId ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/drive/tables/${savedId}`}>
              <Table2 aria-hidden className="size-4" />
              {t("open")}
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={pending}
            onClick={() => void save()}
          >
            <Table2 aria-hidden className="size-4" />
            {t("save")}
          </Button>
        )}
      </div>
    </>
  );
}

/**
 * Markdown components that give every table a Save as table action, or none without a source
 * (a reader who cannot write here). Stable while the source holds.
 */
export function useTaskResultTableComponents(
  source: Source | null,
): Components | undefined {
  const title = source?.title;
  const projectId = source?.projectId ?? null;
  return useMemo(
    () =>
      title === undefined
        ? undefined
        : {
            table: (props) => (
              <SaveableTable source={{ title, projectId }} {...props} />
            ),
          },
    [title, projectId],
  );
}
