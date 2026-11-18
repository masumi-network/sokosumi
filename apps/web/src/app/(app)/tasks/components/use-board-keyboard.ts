"use client";

import { useEffectEvent } from "react";
import { useNewTaskOpener } from "@/app/components/new-task-button.client";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  isEditableKeyboardTarget,
  OPEN_SURFACE_SELECTOR,
} from "@/lib/utils/is-editable-keyboard-target";

const COLUMN_SELECTOR = "[data-column-id]";
const CARD_SELECTOR = "article";
/** A card's title link: what Enter opens, so what the arrows move between. */
const CARD_LINK_SELECTOR = "article h3 a";
const NEW_TASK_KEY = "c";

const ROW_STEP: Partial<Record<string, number>> = {
  ArrowUp: -1,
  ArrowDown: 1,
};
const COLUMN_STEP: Partial<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
};

/**
 * The card title an arrow key moves to from the focused card, or null when
 * the focus is not on a card or there is nowhere to go. Up and Down stay in
 * the column. Left and Right go to the nearest column that has a card, at the
 * same row or its last card.
 */
export function boardFocusTarget(
  key: string,
  active: Element | null,
  root: ParentNode = document,
): HTMLElement | null {
  // The drag wrapper around a card takes focus too, and sits outside it.
  const card =
    active?.closest(CARD_SELECTOR) ??
    active?.querySelector(`:scope > ${CARD_SELECTOR}`);
  if (!card) return null;
  const columns = Array.from(root.querySelectorAll(COLUMN_SELECTOR), (column) =>
    Array.from(column.querySelectorAll<HTMLElement>(CARD_LINK_SELECTOR)),
  );
  const columnIndex = columns.findIndex((links) =>
    links.some((link) => card.contains(link)),
  );
  if (columnIndex < 0) return null;
  const rowIndex = columns[columnIndex].findIndex((link) =>
    card.contains(link),
  );

  const rowStep = ROW_STEP[key];
  if (rowStep) return columns[columnIndex][rowIndex + rowStep] ?? null;

  const columnStep = COLUMN_STEP[key];
  if (!columnStep) return null;
  for (
    let index = columnIndex + columnStep;
    index >= 0 && index < columns.length;
    index += columnStep
  ) {
    const links = columns[index];
    if (links.length > 0) return links[Math.min(rowIndex, links.length - 1)];
  }
  return null;
}

/**
 * Board keys: the arrows move between cards once a card has the focus, and
 * `c` opens the New Task wizard. Enter needs nothing: the focus is on the
 * card's link. A key typed into a field, a dialog or a menu is not ours.
 */
export function useBoardKeyboard() {
  const openNewTask = useNewTaskOpener();
  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    if (isEditableKeyboardTarget(event.target)) return;
    if (
      event.target instanceof Element &&
      event.target.closest(OPEN_SURFACE_SELECTOR)
    ) {
      return;
    }
    if (event.key === NEW_TASK_KEY) {
      if (event.repeat || !openNewTask) return;
      event.preventDefault();
      openNewTask();
      return;
    }
    const target = boardFocusTarget(event.key, document.activeElement);
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  useMountEffect(() => {
    const listener = (event: KeyboardEvent) => handleKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
}
