"use client";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { TableColumn, TableRow } from "@/lib/clients/generated/core";
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
    className: "min-w-40 border-0 bg-transparent shadow-none text-sm",
  };
  return (
    <div className="min-w-48">
      <div className="flex items-center">
        {column.type === "checkbox" || column.type === "single_select" ? (
          <select
            {...props}
            className="bg-background min-h-9 min-w-32 flex-1 rounded px-2 text-sm"
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
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("cellHistory", { column: column.name })}
          onClick={onHistory}
        >
          <History aria-hidden className="size-3.5" />
        </Button>
      </div>
      {error && (
        <div role="alert" className="text-destructive max-w-64 p-2 text-xs">
          {error}
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
