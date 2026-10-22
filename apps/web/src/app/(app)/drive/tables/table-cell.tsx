"use client";
import type { TableColumn, TableRow } from "@sokosumi/core-client";
import { History } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type KeyboardEvent, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";
import { isTableRejection } from "./table-mutations";
import {
  lastUpdatedFormat,
  parseTableInput,
  tableError,
  tableUrlLabel,
  tableValueText,
} from "./table-value";

type Value = TableRow["values"][string];

interface Props {
  column: TableColumn;
  row: TableRow;
  disabled: boolean;
  onSave: (version: number, value: Value) => Promise<void>;
  onHistory: () => void;
  onEditingChange?: (editing: boolean) => void;
}

const ARROW_STEPS: Record<string, [row: number, column: number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/** Moves focus to the read-mode trigger of the neighbouring grid cell. */
function focusNeighbour(event: KeyboardEvent<HTMLElement>) {
  const step = ARROW_STEPS[event.key];
  const cell = event.currentTarget.closest("td");
  const row = cell?.parentElement;
  if (!step || !cell || !row) return;
  const index = [...row.children].indexOf(cell) + step[1];
  const target =
    step[0] === 0
      ? row
      : step[0] < 0
        ? row.previousElementSibling
        : row.nextElementSibling;
  const trigger = target?.children[index]?.querySelector<HTMLElement>(
    "[data-cell-trigger]",
  );
  if (!trigger) return;
  event.preventDefault();
  trigger.focus();
}

/** Focus an editor the moment it replaces the read view, caret at the end. */
function focusEditor(
  node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null,
) {
  if (!node) return;
  node.focus();
  if (
    node instanceof HTMLTextAreaElement ||
    (node instanceof HTMLInputElement && ["text", "url"].includes(node.type))
  )
    node.setSelectionRange(node.value.length, node.value.length);
}

export function TableCell({
  column,
  row,
  disabled,
  onSave,
  onHistory,
  onEditingChange,
}: Props) {
  const t = useTranslations("App.Tables");
  const format = useFormatter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [pending, setPending] = useState(false);
  const version = useRef(row.version);
  const initial = useRef("");
  const returnFocus = useRef(false);
  // Refs, not state: a blur can fire in the same tick as the Enter, change or
  // unmount that already started a save, before React re-renders.
  const active = useRef(false);
  const saving = useRef(false);
  const value = row.values[column.id];
  const text = tableValueText(value);

  function startEditing(next = text) {
    initial.current = text;
    setDraft(next);
    version.current = row.version;
    active.current = true;
    setEditing(true);
  }
  function stopEditing() {
    active.current = false;
    setEditing(false);
    setError("");
    onEditingChange?.(false);
  }
  async function handleSave(next = draft) {
    if (!active.current || saving.current) return;
    if (next === initial.current) {
      stopEditing();
      return;
    }
    saving.current = true;
    setPending(true);
    try {
      const parsed = parseTableInput(column, next);
      setUncertain(true);
      await onSave(version.current, parsed);
      setUncertain(false);
      stopEditing();
    } catch (error) {
      if (isTableRejection(error)) setUncertain(false);
      setError(tableError(error, t));
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  function handleToggle(checked: boolean) {
    const next = String(checked);
    startEditing(next);
    onEditingChange?.(true);
    void handleSave(next);
  }

  const props = {
    ref: focusEditor,
    "aria-label": column.name,
    "aria-invalid": !!error,
    disabled: pending || (!!error && uncertain),
    value: draft,
    onChange: (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      setDraft(event.target.value);
      onEditingChange?.(event.target.value !== initial.current);
    },
    onBlur: () => void handleSave(),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && !uncertain) {
        returnFocus.current = true;
        setDraft(initial.current);
        stopEditing();
      }
      if (event.key === "Enter" && column.type !== "long_text") {
        event.preventDefault();
        returnFocus.current = true;
        (event.target as HTMLElement).blur();
      }
    },
    // `dark:bg-transparent` is for the Textarea branch: the shared Textarea
    // carries `dark:bg-quinary`, so in dark mode a `long_text` cell painted a
    // filled box while every other cell in the same row stayed transparent.
    className:
      "min-w-40 border-0 bg-transparent px-2 shadow-none text-sm dark:bg-transparent",
  };

  function editor() {
    if (column.type === "single_select")
      return (
        <select
          {...props}
          onChange={(event) => {
            props.onChange(event);
            returnFocus.current = true;
            void handleSave(event.target.value);
          }}
          className={withEditableTextSize(
            "bg-background h-10 min-w-32 flex-1 rounded px-2",
          )}
        >
          <option value="">{t("unknown")}</option>
          {column.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    if (column.type === "long_text")
      return (
        <Textarea
          {...props}
          className={cn(props.className, "max-h-40 min-w-0 flex-1")}
          rows={1}
        />
      );
    return (
      <Input
        {...props}
        type={
          column.type === "date"
            ? "date"
            : column.type === "number"
              ? "number"
              : column.type === "email"
                ? "email"
                : column.type === "url"
                  ? "url"
                  : "text"
        }
        step={column.type === "number" ? "any" : undefined}
      />
    );
  }

  function display() {
    if (value == null || text === "") return null;
    switch (column.type) {
      case "long_text":
        return <span className="line-clamp-2 whitespace-pre-line">{text}</span>;
      case "date": {
        const date = new Date(text);
        return (
          <span className="truncate tabular-nums">
            {Number.isNaN(date.getTime())
              ? text
              : format.dateTime(date, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                })}
          </span>
        );
      }
      case "number":
        return <span className="truncate tabular-nums">{text}</span>;
      case "url":
      case "email":
        return (
          <a
            href={column.type === "email" ? `mailto:${text}` : text}
            target={column.type === "url" ? "_blank" : undefined}
            rel={column.type === "url" ? "noopener noreferrer" : undefined}
            // `me-6` keeps a strip beside even the longest link that edits.
            className="pointer-events-auto relative me-6 truncate underline decoration-quaternary underline-offset-2 hover:decoration-current"
          >
            {column.type === "url" ? tableUrlLabel(text) : text}
          </a>
        );
      case "single_select":
      case "multiple_select":
        return (
          <span className="flex min-w-0 gap-1 overflow-hidden">
            {(Array.isArray(value) ? value : [text]).map((option) => (
              <Badge
                key={option}
                variant="outline"
                className="bg-quinary max-w-full shrink truncate border-transparent font-normal"
              >
                {option}
              </Badge>
            ))}
          </span>
        );
      default:
        return <span className="truncate">{text}</span>;
    }
  }

  return (
    // Bounded so a long value truncates instead of widening its whole column.
    <div
      className={cn(
        "group/cell min-w-48",
        column.type === "long_text" ? "max-w-96 min-w-64" : "max-w-80",
      )}
    >
      <div className="flex items-start gap-1">
        {column.type === "checkbox" ? (
          <div className="flex min-h-8 flex-1 items-center px-2">
            <Checkbox
              data-cell-trigger
              aria-label={column.name}
              checked={editing ? draft === "true" : value === true}
              disabled={disabled || pending || (!!error && uncertain)}
              onCheckedChange={(checked) => handleToggle(checked === true)}
              onKeyDown={focusNeighbour}
            />
          </div>
        ) : !editing ? (
          // Read mode: the value as text, with one transparent button over the
          // whole cell that swaps in the editor. Links sit above that button
          // so they stay clickable; the rest of the cell edits.
          <div className="relative flex min-h-8 min-w-0 flex-1 items-start px-2 py-1.5 text-sm leading-5">
            <button
              type="button"
              data-cell-trigger
              ref={(node) => {
                if (node && returnFocus.current) {
                  returnFocus.current = false;
                  node.focus();
                }
              }}
              aria-label={t("editCell", { column: column.name })}
              title={text || undefined}
              disabled={disabled}
              onClick={() => startEditing()}
              onKeyDown={focusNeighbour}
              className="focus-visible:ring-ring absolute inset-0 rounded-md outline-none focus-visible:ring-2 enabled:cursor-text"
            />
            <div className="pointer-events-none flex min-w-0 flex-1">
              {display()}
            </div>
          </div>
        ) : (
          editor()
        )}
        {/* The affordance belongs to one cell out of hundreds, and painting
        every one turned the grid into a field of icons, so it is revealed by
        pointer or focus. It keeps its 32px in flow whether or not it is
        painted, because nothing may sit on top of an open editor. It stays in
        the DOM, in the accessibility tree and in the tab order, so a keyboard
        or screen-reader user is unaffected. */}
        <Button
          size="icon"
          variant="ghost"
          className="text-muted-foreground hit-area size-8 shrink-0 opacity-0 transition-opacity group-focus-within/cell:opacity-100 group-hover/cell:opacity-100 focus-visible:opacity-100"
          aria-label={t("cellHistory", { column: column.name })}
          onClick={onHistory}
        >
          <History aria-hidden className="size-3.5" />
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="text-destructive flex max-w-64 flex-wrap items-center gap-2 px-2 pb-2 text-xs whitespace-normal"
        >
          <span className="min-w-0 break-words">{error}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void handleSave()}
          >
            {t("retry")}
          </Button>
          {!uncertain && (
            <Button size="sm" variant="outline" onClick={stopEditing}>
              {t("discard")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Read-only: Core moves a row's updatedAt on every change, so there is nothing to edit. */
export function TableUpdatedCell({ row }: { row: TableRow }) {
  const format = useFormatter();
  const updatedAt = new Date(row.updatedAt);
  return (
    <div className="text-muted-foreground flex h-10 min-w-40 items-center px-2 text-sm whitespace-nowrap tabular-nums">
      <time
        dateTime={updatedAt.toISOString()}
        title={format.dateTime(updatedAt, "dateTimeWithSeconds")}
      >
        {format.dateTime(updatedAt, lastUpdatedFormat(updatedAt, new Date()))}
      </time>
    </div>
  );
}
