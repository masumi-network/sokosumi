import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";

export interface SelectItem<T> {
  value: T;
  label: string;
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
}: {
  items: readonly SelectItem<T>[];
  onSelect: (value: T) => void;
  initialIndex?: number;
  listen?: boolean;
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
    if (key.upArrow) {
      setIndex((current) => moveSelectionIndex(current, -1, items.length));
      return;
    }
    if (key.downArrow) {
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
    { flexDirection: "column" },
    ...items.map((item, itemIndex) => {
      const selected = itemIndex === index;
      return React.createElement(
        Text,
        { key: item.label, color: selected ? "cyan" : undefined },
        `${selected ? "›" : " "} ${item.label}`,
      );
    }),
  );
}
