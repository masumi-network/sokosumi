"use client";

import { Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  type ComponentProps,
  use,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { cn } from "@/lib/utils";
import {
  TaskResultTableTooLarge,
  taskResultTablePlan,
} from "./task-result-table";
import { TaskTableEvent } from "./task-table-event";

/**
 * The Task a saved Table comes from: its name titles the Table, and the Table joins its workspace (null:
 * personal) and project.
 */
type Source = {
  taskId: string;
  workspaceId: string | null;
  title: string;
  projectId: string | null;
};

/**
 * Copies by workspace, project, Task, activity event and table, outside the row: a new activity event or a
 * layout switch mounts the comment afresh, and it must still link to the Table it saved, or finish that same
 * copy, never start a second. A Task moved to another workspace or project starts a fresh copy there.
 * ponytail: lives for the page session; a Table deleted meanwhile still shows Open table until reload.
 */
const copies = new Map<string, TableCopy & { run?: Promise<string> }>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const savedTableId = (key: string) => {
  const copy = copies.get(key);
  return copy?.done === copy?.plan.batches.length ? copy?.tableId : undefined;
};

/**
 * The error toasts carry how to finish the copy: they stay until dismissed. The success toast goes by itself:
 * the row keeps Open table, and on a phone a toast that stays covers the comment Submit.
 */
const STAY = { duration: Infinity, closeButton: true };

function SaveableTable({
  source,
  ...props
}: ComponentProps<typeof MarkdownTable> & { source: Source }) {
  const t = useTranslations("App.Tasks.Detail.saveTable");
  const format = useFormatter();
  const router = useRouter();
  const table = useRef<HTMLTableElement>(null);
  const [pending, setPending] = useState(false);
  const clipped = use(MarkdownClippedContext);
  const event = use(TaskTableEvent);
  // Where the table sits in its comment, and its cells: two tables in one comment stay two copies.
  const key = [
    source.workspaceId,
    source.projectId,
    source.taskId,
    event,
    props.node?.position?.start.offset,
    JSON.stringify(props.node, ["type", "tagName", "value", "children"]),
  ].join(":");
  const savedId = useSyncExternalStore(
    subscribe,
    () => savedTableId(key),
    () => undefined,
  );

  async function save() {
    if (!table.current) return;
    setPending(true);
    try {
      // The cells as the reader sees them; a failed save keeps its plan and finishes on the next press.
      const copy = copies.get(key) ?? {
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
      copies.set(key, copy);
      // A press from a remounted row joins a save still running rather than racing it.
      copy.run ??= finishTableCopy(copy).finally(() => {
        copy.run = undefined;
      });
      const id = await copy.run;
      for (const listener of listeners) listener();
      const { total } = tableCopyRows(copy);
      toast.success(t("saved", { count: total }), {
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
      const copy = copies.get(key);
      const rows = copy && tableCopyRows(copy);
      toast.error(rows?.saved ? t("partial", rows) : t("failed"), STAY);
    } finally {
      setPending(false);
    }
  }

  if (event === null) return <MarkdownTable {...props} />;
  return (
    <>
      <MarkdownTable ref={table} {...props} />
      {/* While the activity is clipped the action is hidden and inert: nobody can see or reach it, and
      nothing faded looks live. It keeps its place: removing it would change the height the clamp is
      measured on. */}
      <div
        data-table-action
        inert={clipped}
        className={cn(
          "not-prose -mt-1.5 mb-3 flex justify-end",
          clipped && "invisible",
        )}
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
  const taskId = source?.taskId;
  const workspaceId = source?.workspaceId ?? null;
  const title = source?.title;
  const projectId = source?.projectId ?? null;
  return useMemo(
    () =>
      taskId === undefined || title === undefined
        ? undefined
        : {
            table: (props) => (
              <SaveableTable
                source={{ taskId, workspaceId, title, projectId }}
                {...props}
              />
            ),
          },
    [taskId, workspaceId, title, projectId],
  );
}
