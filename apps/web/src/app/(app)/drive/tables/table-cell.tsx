"use client";
import type { TableColumn, TableRow } from "@sokosumi/core-client";
import { ExternalLink, History } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { GRID_SELECTED_CELL } from "@/components/data-grid/grid-classes";
import {
  type GridCellProps,
  handleGridKey,
} from "@/components/data-grid/grid-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";
import { type CellWrap, cellWrap } from "./table-layout";
import { isTableRejection } from "./table-mutations";
import {
  lastUpdatedFormat,
  parseTableInput,
  tableError,
  tableUrlLabel,
  tableValueText,
} from "./table-value";

type Value = TableRow["values"][string];

interface Props extends GridCellProps {
  column: TableColumn;
  row: TableRow;
  disabled: boolean;
  onSave: (version: number, value: Value) => Promise<void>;
  onHistory: () => void;
  onEditingChange?: (editing: boolean) => void;
}

/** Types where a typed character replaces the value, as in a spreadsheet. */
const TYPE_TO_REPLACE = new Set<TableColumn["type"]>([
  "text",
  "long_text",
  "number",
  "url",
  "email",
  "multiple_select",
]);

const WRAP_TEXT: Record<CellWrap, string> = {
  clip: "truncate",
  clamp: "line-clamp-2 whitespace-pre-line break-words",
  wrap: "whitespace-pre-line break-words",
};

/** Focus an editor the moment it opens, caret at the end. */
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

/**
 * One grid cell. A single click (or focus) selects it; a double click, Enter,
 * F2 or a typed character opens the editor, which floats over the cell so
 * opening it never moves the grid. Enter and Tab commit and move on, Escape
 * cancels and keeps the selection, and paste saves through the same path as
 * typing, so its errors read the same.
 */
export function TableCell({
  id,
  column,
  row,
  disabled,
  active,
  tabbable,
  className,
  onActivate,
  onNavigate,
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
  const cell = useRef<HTMLTableCellElement>(null);
  const version = useRef(row.version);
  const initial = useRef("");
  // Refs, not state: a blur can fire in the same tick as the Enter, change or
  // unmount that already started a save, before React re-renders.
  const open = useRef(false);
  const saving = useRef(false);
  const tapToEdit = useRef(false);
  const value = row.values[column.id];
  const text = tableValueText(value);
  const wrap = cellWrap(column);
  const editable = !disabled && column.type !== "checkbox";
  const href =
    text && column.type === "url"
      ? text
      : text && column.type === "email"
        ? `mailto:${text}`
        : null;

  function startEditing(next = text) {
    initial.current = text;
    setDraft(next);
    version.current = row.version;
    open.current = true;
    setEditing(true);
    if (next !== text) onEditingChange?.(true);
  }
  function stopEditing() {
    open.current = false;
    setEditing(false);
    setError("");
    onEditingChange?.(false);
    // An editor that still has focus as it closes hands it back to its cell.
    if (cell.current?.contains(document.activeElement)) cell.current.focus();
  }
  async function handleSave(next = draft) {
    if (!open.current || saving.current) return;
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
  /** Saves a whole new value at once: a checkbox toggle or a paste. */
  function commit(next: string) {
    startEditing(next);
    void handleSave(next);
  }

  function handleCellKeyDown(event: KeyboardEvent<HTMLTableCellElement>) {
    if (event.target !== event.currentTarget) return;
    if (handleGridKey(event, text, onNavigate)) return;
    if (event.key === "Enter" && event.altKey && href) {
      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    if (event.altKey && event.shiftKey && event.code === "KeyH") {
      event.preventDefault();
      onHistory();
      return;
    }
    if (disabled || pending) return;
    if (column.type === "checkbox") {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        commit(String(value !== true));
      }
      return;
    }
    if (editing) {
      // A failed save leaves its editor open; Enter goes back into it.
      if (event.key === "Enter" || event.key === "F2") {
        event.preventDefault();
        cell.current
          ?.querySelector<HTMLElement>("input, textarea, select")
          ?.focus();
      }
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      startEditing();
    } else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      startEditing(TYPE_TO_REPLACE.has(column.type) ? event.key : text);
    }
  }
  function handlePaste(event: ClipboardEvent<HTMLTableCellElement>) {
    if (event.target !== event.currentTarget || disabled || editing) return;
    event.preventDefault();
    // A row copied from a spreadsheet ends in a newline; the value does not.
    commit(event.clipboardData.getData("text/plain").replace(/\r?\n$/, ""));
  }
  function handleEditorKeyDown(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && !uncertain) {
      event.preventDefault();
      setDraft(initial.current);
      stopEditing();
      cell.current?.focus();
      return;
    }
    const newline =
      column.type === "long_text" &&
      (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey);
    if ((event.key === "Enter" && !newline) || event.key === "Tab") {
      // Moving focus blurs the editor, and the blur saves.
      event.preventDefault();
      const move =
        event.key === "Enter" ? "down" : event.shiftKey ? "left" : "right";
      if (!onNavigate(move)) cell.current?.focus();
    }
  }

  const editorProps = {
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
    onKeyDown: handleEditorKeyDown,
    className:
      "w-full min-w-0 border-0 bg-transparent px-2 shadow-none text-sm dark:bg-transparent",
  };

  function editor() {
    if (column.type === "single_select")
      return (
        <select
          {...editorProps}
          onChange={(event) => {
            editorProps.onChange(event);
            void handleSave(event.target.value);
          }}
          className={withEditableTextSize(
            "bg-background h-10 w-full rounded px-2",
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
          {...editorProps}
          className={cn(editorProps.className, "max-h-60 min-h-24")}
          rows={3}
        />
      );
    return (
      <Input
        {...editorProps}
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

  /** The value as it reads; `data-fit` marks what fit-to-content measures. */
  function display(): ReactNode {
    if (column.type === "checkbox")
      return (
        <Checkbox
          tabIndex={-1}
          aria-label={column.name}
          checked={editing ? draft === "true" : value === true}
          disabled={disabled || pending || (!!error && uncertain)}
          onCheckedChange={(checked) => commit(String(checked === true))}
        />
      );
    if (value == null || text === "") return null;
    switch (column.type) {
      case "date": {
        const date = new Date(text);
        return (
          <span data-fit className={cn(WRAP_TEXT[wrap], "tabular-nums")}>
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
        return (
          <span data-fit className={cn(WRAP_TEXT[wrap], "tabular-nums")}>
            {text}
          </span>
        );
      case "url":
      case "email":
        // A click selects the cell like any other; Cmd/Ctrl-click and
        // middle-click still open the link, which is why it stays a link.
        return (
          <a
            data-fit
            href={href ?? undefined}
            tabIndex={-1}
            target={column.type === "url" ? "_blank" : undefined}
            rel={column.type === "url" ? "noopener noreferrer" : undefined}
            onClick={(event) => {
              if (!event.metaKey && !event.ctrlKey) event.preventDefault();
            }}
            className={cn(
              WRAP_TEXT[wrap],
              "min-w-0 underline decoration-quaternary underline-offset-2 hover:decoration-current",
            )}
          >
            {column.type === "url" ? tableUrlLabel(text) : text}
          </a>
        );
      case "single_select":
      case "multiple_select":
        return (
          <span
            data-fit
            className={cn(
              "flex min-w-0 gap-1",
              wrap === "clip" ? "overflow-hidden" : "flex-wrap",
            )}
          >
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
        return (
          <span data-fit className={cn(WRAP_TEXT[wrap], "min-w-0")}>
            {text}
          </span>
        );
    }
  }

  return (
    <td
      ref={cell}
      id={id}
      data-column={column.id}
      role="gridcell"
      aria-selected={active}
      aria-readonly={disabled || undefined}
      aria-keyshortcuts={href ? "Alt+Enter Alt+Shift+H" : "Alt+Shift+H"}
      tabIndex={tabbable ? 0 : -1}
      title={wrap === "wrap" ? undefined : text || undefined}
      onFocus={onActivate}
      onKeyDown={handleCellKeyDown}
      onPaste={handlePaste}
      onPointerDown={(event) => {
        // A tap on the selected cell edits: touch has no double click.
        tapToEdit.current = event.pointerType !== "mouse" && active;
      }}
      onClick={() => {
        if (tapToEdit.current && editable && !editing) startEditing();
      }}
      onDoubleClick={() => {
        if (editable && !editing) startEditing();
      }}
      className={cn(
        "group/cell relative border-e border-b p-0 align-top select-none",
        active ? GRID_SELECTED_CELL : "outline-none",
        editing && "z-15",
        className,
      )}
    >
      <div className="flex min-h-8 min-w-0 items-start px-2 py-1.5 text-sm leading-5">
        {display()}
      </div>
      {!editing && column.type !== "checkbox" && (
        // Revealed by pointer or selection: painting these on every cell
        // turned the grid into a field of icons. They are the pointer path
        // only: the keyboard and screen readers reach the same actions with
        // Alt+Enter and Alt+Shift+H on the selected cell, which announces
        // them, so they stay out of each cell's name and never take focus.
        <div
          aria-hidden
          onMouseDown={(event) => event.preventDefault()}
          className={cn(
            "bg-card-background group-hover/row:bg-card-background-hover absolute end-0.5 top-0.5 flex opacity-0 transition-opacity group-hover/cell:opacity-100",
            active && "opacity-100",
          )}
        >
          {href && (
            <Button
              asChild
              size="icon"
              variant="ghost"
              className="text-muted-foreground hit-area size-8"
            >
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                tabIndex={-1}
                aria-label={t("openLink", { column: column.name })}
              >
                <ExternalLink aria-hidden className="size-3.5" />
              </a>
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            tabIndex={-1}
            className="text-muted-foreground hit-area size-8"
            aria-label={t("cellHistory", { column: column.name })}
            onClick={onHistory}
          >
            <History aria-hidden className="size-3.5" />
          </Button>
        </div>
      )}
      {editing && column.type !== "checkbox" && (
        <div
          className={cn(
            "bg-background absolute start-0 top-0 min-w-full rounded-sm shadow-md select-text",
            GRID_SELECTED_CELL,
            column.type === "long_text" ? "w-96" : "w-72",
          )}
        >
          {editor()}
          {error && (
            <div
              role="alert"
              className="text-destructive flex flex-wrap items-center gap-2 px-2 pb-2 text-xs whitespace-normal"
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
      )}
      {column.type === "checkbox" && error && (
        <div
          role="alert"
          className="bg-background text-destructive absolute start-0 top-full z-10 w-64 rounded-sm p-2 text-xs shadow-md"
        >
          {error}
        </div>
      )}
    </td>
  );
}

/** Read-only: Core moves a row's updatedAt on every change, so there is nothing to edit. */
export function TableUpdatedCell({
  id,
  row,
  columnId,
  active,
  tabbable,
  className,
  onActivate,
  onNavigate,
}: GridCellProps & { row: TableRow; columnId: string }) {
  const format = useFormatter();
  const updatedAt = new Date(row.updatedAt);
  const label = format.dateTime(
    updatedAt,
    lastUpdatedFormat(updatedAt, new Date()),
  );
  return (
    <td
      id={id}
      data-column={columnId}
      role="gridcell"
      aria-selected={active}
      aria-readonly
      tabIndex={tabbable ? 0 : -1}
      onFocus={onActivate}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget)
          handleGridKey(event, label, onNavigate);
      }}
      className={cn(
        "text-muted-foreground border-e border-b p-0 align-top select-none",
        active ? GRID_SELECTED_CELL : "outline-none",
        className,
      )}
    >
      <div className="flex min-h-8 items-start px-2 py-1.5 text-sm leading-5 whitespace-nowrap tabular-nums">
        <time
          data-fit
          className="truncate"
          dateTime={updatedAt.toISOString()}
          title={format.dateTime(updatedAt, "dateTimeWithSeconds")}
        >
          {label}
        </time>
      </div>
    </td>
  );
}
