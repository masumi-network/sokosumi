"use client";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { GRID_SELECTED_CELL } from "@/components/data-grid/grid-classes";
import {
  type GridCellProps,
  handleGridKey,
} from "@/components/data-grid/grid-keys";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { GroupedRadioItems } from "./contacts-toolbar";

export interface CellChoice {
  value: string;
  label: string;
  icon?: ReactNode;
  /** Heading of the group this choice starts or belongs to. */
  group?: string;
}

export type CellEdit =
  | {
      kind: "text" | "date";
      value: string;
      onSave: (value: string) => Promise<boolean>;
    }
  | {
      kind: "choice";
      value: string;
      choices: CellChoice[];
      onSave: (value: string) => Promise<boolean>;
    };

interface Props extends GridCellProps {
  columnId: string;
  label: string;
  /** What Cmd/Ctrl+C copies and the tooltip shows. */
  text: string;
  children: ReactNode;
  edit?: CellEdit;
  /** Enter on this cell opens something (the person) instead of editing. */
  onOpen?: () => void;
}

/**
 * A contacts grid cell, on the same keyboard model as the Files tables grid:
 * selecting is a click or focus; Enter, F2, a double click or typing edits;
 * Enter and Tab commit and move on; Escape cancels. A choice opens a menu.
 */
export function ContactCell({
  id,
  active,
  tabbable,
  className,
  onActivate,
  onNavigate,
  columnId,
  label,
  text,
  children,
  edit,
  onOpen,
}: Props) {
  const cell = useRef<HTMLTableCellElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const saving = useRef(false);
  const open = useRef(false);

  function startEditing(initial = edit?.value ?? "") {
    if (!edit) return;
    if (edit.kind === "choice") {
      setMenuOpen(true);
      return;
    }
    setDraft(initial);
    open.current = true;
    setEditing(true);
  }
  function stopEditing() {
    open.current = false;
    setEditing(false);
    if (cell.current?.contains(document.activeElement)) cell.current.focus();
  }
  async function commit(next = draft) {
    if (!edit || !open.current || saving.current) return;
    if (next === edit.value) {
      stopEditing();
      return;
    }
    saving.current = true;
    stopEditing();
    await edit.onSave(next);
    saving.current = false;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableCellElement>) {
    if (event.target !== event.currentTarget) return;
    if (handleGridKey(event, text, onNavigate)) return;
    if (event.key === "Enter" && onOpen && !event.altKey) {
      event.preventDefault();
      onOpen();
      return;
    }
    if (!edit) return;
    if (event.key === "Enter" || event.key === "F2" || event.key === " ") {
      event.preventDefault();
      startEditing();
    } else if (
      edit.kind === "text" &&
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      startEditing(event.key);
    }
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stopEditing();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      void commit();
      const move =
        event.key === "Enter" ? "down" : event.shiftKey ? "left" : "right";
      onNavigate(move);
    }
  }

  return (
    <td
      ref={cell}
      id={id}
      data-column={columnId}
      role="gridcell"
      aria-selected={active}
      aria-readonly={!edit || undefined}
      tabIndex={tabbable ? 0 : -1}
      title={text || undefined}
      onFocus={onActivate}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => {
        if (!editing) startEditing();
      }}
      className={cn(
        "group/cell relative border-e border-b p-0 align-middle select-none",
        active ? GRID_SELECTED_CELL : "outline-none",
        editing && "z-15",
        className,
      )}
    >
      <div className="flex h-9 min-w-0 items-center px-3 text-sm">
        {children}
      </div>
      {editing && edit && edit.kind !== "choice" ? (
        <div
          className={cn(
            "bg-background absolute start-0 top-0 w-full min-w-56 rounded-sm shadow-md",
            GRID_SELECTED_CELL,
          )}
        >
          <Input
            ref={(node) => {
              if (node && document.activeElement !== node) {
                node.focus();
                if (node.type === "text")
                  node.setSelectionRange(node.value.length, node.value.length);
              }
            }}
            aria-label={label}
            type={edit.kind === "date" ? "date" : "text"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={handleEditorKeyDown}
            className="h-9 border-0 bg-transparent px-3 shadow-none dark:bg-transparent"
          />
        </div>
      ) : null}
      {edit?.kind === "choice" ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden
              tabIndex={-1}
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-96 min-w-48 overflow-y-auto"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              cell.current?.focus();
            }}
          >
            <DropdownMenuRadioGroup
              value={edit.value}
              onValueChange={(value) => {
                setMenuOpen(false);
                if (value !== edit.value) void edit.onSave(value);
              }}
            >
              <GroupedRadioItems options={edit.choices} />
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </td>
  );
}
