import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";
import { TUI_THEME } from "./theme.js";

export interface SelectItem<T> {
  value: T;
  label: string;
  hint?: string;
}

export function moveSelectionIndex(
  index: number,
  direction: -1 | 1,
  itemCount: number,
): number {
  if (itemCount <= 0) return 0;
  const next = index + direction;
  if (next < 0) return itemCount - 1;
  if (next >= itemCount) return 0;
  return next;
}

export function SelectInput<T>({
  items,
  onSelect,
  initialIndex = 0,
  listen = true,
  direction = "vertical",
}: {
  items: readonly SelectItem<T>[];
  onSelect: (value: T) => void;
  initialIndex?: number;
  listen?: boolean;
  direction?: "vertical" | "horizontal";
}): React.ReactElement {
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(initialIndex, Math.max(items.length - 1, 0))),
  );

  useEffect(() => {
    setIndex((current) =>
      Math.max(0, Math.min(current, Math.max(items.length - 1, 0))),
    );
  }, [items.length]);

  useInput((_input, key) => {
    if (!listen || items.length === 0) return;
    if (key.upArrow || (direction === "horizontal" && key.leftArrow)) {
      setIndex((current) => moveSelectionIndex(current, -1, items.length));
      return;
    }
    if (key.downArrow || (direction === "horizontal" && key.rightArrow)) {
      setIndex((current) => moveSelectionIndex(current, 1, items.length));
      return;
    }
    if (key.return) {
      const item = items[index];
      if (item) onSelect(item.value);
    }
  });

  return React.createElement(
    Box,
    {
      flexDirection: direction === "horizontal" ? "row" : "column",
      flexWrap: direction === "horizontal" ? "wrap" : undefined,
      borderStyle: "single",
      borderColor: TUI_THEME.border,
      paddingX: 1,
      width: "100%",
    },
    ...items.map((item, itemIndex) => {
      const selected = itemIndex === index;
      return React.createElement(
        Text,
        {
          key: `${item.label}-${itemIndex}`,
          color: selected ? TUI_THEME.accent : undefined,
          bold: selected,
        },
        direction === "horizontal"
          ? React.createElement(
              React.Fragment,
              null,
              `${selected ? "▸" : " "} ${item.label}`,
              item.hint
                ? React.createElement(Text, { dimColor: true }, ` ${item.hint}`)
                : null,
            )
          : React.createElement(
              React.Fragment,
              null,
              `${selected ? "›" : " "} ${item.label}`,
              item.hint
                ? React.createElement(Text, { dimColor: true }, ` ${item.hint}`)
                : null,
            ),
      );
    }),
  );
}
