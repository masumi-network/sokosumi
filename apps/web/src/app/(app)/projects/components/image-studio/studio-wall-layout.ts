import { STUDIO_EMPTY_ADS } from "./studio-empty-ads";
import { STUDIO_TEMPLATES } from "./studio-templates";

interface StudioWallCard {
  adIndex: number;
  y: number;
  height: number;
}

interface StudioWallColumn {
  cards: StudioWallCard[];
  period: number;
  phase: number;
  verticalCopies: number;
}

export interface StudioWallLayout {
  width: number;
  height: number;
  columnWidth: number;
  gap: number;
  periodX: number;
  horizontalCopies: number;
  columns: StudioWallColumn[];
}

interface StudioWallOffset {
  x: number;
  y: number;
}

interface StudioWallRect extends StudioWallCard {
  x: number;
  width: number;
}

function orderColumnCards(cards: StudioWallCard[]) {
  const groups = new Map<string, StudioWallCard[]>();
  for (const card of cards) {
    const ad = STUDIO_EMPTY_ADS[card.adIndex];
    const shape = STUDIO_TEMPLATES[ad.templateIndex].aspectRatio;
    const group = groups.get(shape) ?? [];
    group.push(card);
    groups.set(shape, group);
  }

  const ordered = [...cards];
  let position = 0;
  // Largest shape groups fill alternating slots, including the wrap seam.
  for (const group of [...groups.values()].sort(
    (a, b) => b.length - a.length,
  )) {
    for (const card of group) {
      ordered[position] = card;
      position += 2;
      if (position >= cards.length) position = 1;
    }
  }
  return ordered;
}

export function buildStudioWall({
  width,
  height,
}: {
  width: number;
  height: number;
}): StudioWallLayout {
  const columnWidth = Math.min(248, Math.max(148, Math.round(width / 6.2)));
  const gap = 12;
  const columnCount = Math.min(
    8,
    Math.max(3, Math.ceil((width + columnWidth) / (columnWidth + gap))),
  );
  const periodX = columnCount * (columnWidth + gap);
  const columns: StudioWallColumn[] = Array.from(
    { length: columnCount },
    () => ({ cards: [], period: 0, phase: 0, verticalCopies: 0 }),
  );
  const cards = STUDIO_EMPTY_ADS.map((ad, adIndex) => {
    const [aspectWidth, aspectHeight] = STUDIO_TEMPLATES[
      ad.templateIndex
    ].aspectRatio
      .split(":")
      .map(Number);
    return {
      adIndex,
      y: 0,
      height: columnWidth / (aspectWidth / aspectHeight),
    };
  }).sort((a, b) => b.height - a.height || a.adIndex - b.adIndex);

  for (const card of cards) {
    const column = columns.reduce((shortest, candidate) =>
      candidate.period < shortest.period ? candidate : shortest,
    );
    column.cards.push(card);
    column.period += card.height + gap;
  }

  for (const [columnIndex, column] of columns.entries()) {
    let y = 0;
    column.cards = orderColumnCards(column.cards).map((card) => {
      const placed = { ...card, y };
      y += card.height + gap;
      return placed;
    });
    column.phase = (columnIndex * column.period) / columnCount;
    column.verticalCopies = Math.ceil(height / column.period) + 1;
  }

  return {
    width,
    height,
    columnWidth,
    gap,
    periodX,
    horizontalCopies: Math.ceil(width / periodX) + 1,
    columns,
  };
}

function mod(value: number, period: number) {
  return ((value % period) + period) % period;
}

export function getStudioWallTransform(
  layout: StudioWallLayout,
  offset: StudioWallOffset,
) {
  return {
    x: mod(offset.x, layout.periodX) - layout.periodX,
    columnY: layout.columns.map(
      (column) => mod(offset.y + column.phase, column.period) - column.period,
    ),
  };
}

export function getVisibleStudioWallRects(
  layout: StudioWallLayout,
  offset: StudioWallOffset,
): StudioWallRect[] {
  const transform = getStudioWallTransform(layout, offset);
  const rects: StudioWallRect[] = [];
  for (let copyX = 0; copyX < layout.horizontalCopies; copyX++) {
    for (const [columnIndex, column] of layout.columns.entries()) {
      const x =
        transform.x +
        copyX * layout.periodX +
        columnIndex * (layout.columnWidth + layout.gap);
      if (x + layout.columnWidth <= 0 || x >= layout.width) continue;
      for (let copyY = 0; copyY < column.verticalCopies; copyY++) {
        for (const card of column.cards) {
          const y =
            transform.columnY[columnIndex] + copyY * column.period + card.y;
          if (y + card.height <= 0 || y >= layout.height) continue;
          rects.push({ ...card, x, y, width: layout.columnWidth });
        }
      }
    }
  }
  return rects;
}
