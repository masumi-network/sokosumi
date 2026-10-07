"use client";
import type { TableColumn, TableRow } from "@sokosumi/core-client";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";
import { isTableRejection } from "./table-mutations";
import { parseTableInput, tableError, tableValueText } from "./table-value";

interface Props {
  column: TableColumn;
  row: TableRow;
  disabled: boolean;
  onSave: (version: number, value: TableRow["values"][string]) => Promise<void>;
  onHistory: () => void;
  onEditingChange?: (editing: boolean) => void;
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [pending, setPending] = useState(false);
  const version = useRef(row.version);
  const initial = useRef("");
  function handleFocus() {
    if (editing) return;
    initial.current = tableValueText(row.values[column.id]);
    setDraft(initial.current);
    version.current = row.version;
    setEditing(true);
  }
  async function handleSave() {
    if (!editing || pending) return;
    if (draft === initial.current) {
      setEditing(false);
      onEditingChange?.(false);
      return;
    }
    setPending(true);
    try {
      const value = parseTableInput(column, draft);
      setUncertain(true);
      await onSave(version.current, value);
      setUncertain(false);
      setError("");
      setEditing(false);
      onEditingChange?.(false);
    } catch (error) {
      if (isTableRejection(error)) setUncertain(false);
      setError(tableError(error, t));
    } finally {
      setPending(false);
    }
  }
  const props = {
    "aria-label": column.name,
    "aria-invalid": !!error,
    disabled: (disabled && !editing) || pending || (!!error && uncertain),
    value: editing ? draft : tableValueText(row.values[column.id]),
    onFocus: handleFocus,
    onChange: (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      if (!editing) handleFocus();
      setDraft(event.target.value);
      onEditingChange?.(event.target.value !== initial.current);
    },
    onBlur: () => void handleSave(),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && !uncertain) {
        setDraft(initial.current);
        setEditing(false);
        onEditingChange?.(false);
        setError("");
      }
      if (event.key === "Enter" && column.type !== "long_text") {
        event.preventDefault();
        (event.target as HTMLElement).blur();
      }
    },
    // `dark:bg-transparent` is for the Textarea branch: the shared Textarea
    // carries `dark:bg-quinary`, so in dark mode a `long_text` cell painted a
    // filled box while every other cell in the same row stayed transparent.
    className:
      "min-w-40 border-0 bg-transparent px-2 shadow-none text-sm dark:bg-transparent",
  };
  return (
    <div className="group/cell min-w-48">
      <div className="flex items-center gap-1">
        {column.type === "checkbox" || column.type === "single_select" ? (
          <select
            {...props}
            className={withEditableTextSize(
              "bg-background h-10 min-w-32 flex-1 rounded px-2",
            )}
          >
            <option value="">{t("unknown")}</option>
            {column.type === "checkbox" ? (
              <>
                <option value="true">{t("yes")}</option>
                <option value="false">{t("no")}</option>
              </>
            ) : (
              column.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))
            )}
          </select>
        ) : column.type === "long_text" ? (
          <Textarea {...props} rows={1} />
        ) : (
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
        )}
        {/* The affordance belongs to one cell out of hundreds, and painting
        every one turned the grid into a field of icons, so it is revealed by
        pointer or focus. This is a visual-noise fix, not a width fix: the
        button keeps its 32px in flow whether or not it is painted, which is
        deliberate — reclaiming that space would mean overlaying the button on
        the text being edited, and nothing may sit on top of an open editor.
        The button stays in the DOM, in the accessibility tree and in the tab
        order, so a keyboard or screen-reader user is unaffected; focusing the
        cell — which is also what a tap does — reveals it. Its `hit-area`
        reaches 4px past the box below md, which the row's `gap-1` absorbs, so
        a tap on the editor's edge still lands in the editor. */}
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(false);
                onEditingChange?.(false);
                setError("");
              }}
            >
              {t("discard")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
