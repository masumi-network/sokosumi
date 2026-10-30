"use client";
import { type KeyboardEvent, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * A value that reads as text and edits in place: click or Enter opens it,
 * Enter (Cmd/Ctrl+Enter for long text) or leaving saves, Escape cancels.
 */
export function InlineField({
  label,
  value,
  placeholder,
  multiline = false,
  type = "text",
  className,
  displayClassName,
  maxLength,
  display,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  type?: "text" | "date";
  className?: string;
  displayClassName?: string;
  maxLength?: number;
  /** How the saved value reads, when not as typed (a formatted date). */
  display?: string;
  onSave: (value: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function open() {
    setDraft(value);
    setEditing(true);
  }
  function save() {
    setEditing(false);
    if (draft.trim() !== value.trim()) void onSave(draft.trim());
  }
  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setEditing(false);
    } else if (
      event.key === "Enter" &&
      (!multiline || event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      save();
    }
  }

  if (editing) {
    const shared = {
      "aria-label": label,
      value: draft,
      maxLength,
      autoFocus: true,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => setDraft(event.target.value),
      onBlur: save,
      onKeyDown: handleKeyDown,
    };
    return multiline ? (
      <Textarea {...shared} rows={4} className={cn("min-h-24", className)} />
    ) : (
      <Input {...shared} type={type} className={cn("h-9", className)} />
    );
  }

  return (
    <button
      type="button"
      aria-label={value ? `${label}: ${value}` : label}
      onClick={open}
      className={cn(
        "hover:bg-accent focus-visible:ring-ring -mx-2 min-h-9 w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-start text-sm transition-colors outline-none focus-visible:ring-2",
        multiline ? "whitespace-pre-line" : "truncate",
        !value && "text-muted-foreground",
        className,
        displayClassName,
      )}
    >
      {value ? (display ?? value) : placeholder}
    </button>
  );
}
