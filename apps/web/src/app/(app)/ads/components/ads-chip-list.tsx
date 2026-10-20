import { ChipRemoveButton } from "@/components/ui/chip-remove-button";
import type { GoogleTarget } from "@/lib/ads/targeting";

interface AdsChipListProps {
  /** `name` is shown; `detail`, when there is one, is the full name for a hint. */
  items: GoogleTarget[];
  /** Said when there are no items; without it, an empty list renders nothing. */
  emptyLabel?: string;
  /** The remove button's label for a chip, given its full name. */
  removeLabel: (name: string) => string;
  onRemove: (id: string) => void;
}

/** Chosen items as removable chips. */
export function AdsChipList({
  items,
  emptyLabel,
  removeLabel,
  onRemove,
}: AdsChipListProps) {
  if (items.length === 0) {
    return emptyLabel ? (
      <p className="text-muted-foreground text-sm">{emptyLabel}</p>
    ) : null;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map(({ id, name, detail }) => (
        <li
          key={id}
          title={detail}
          className="bg-muted text-foreground inline-flex items-center rounded-full pl-3 text-sm"
        >
          {name}
          <ChipRemoveButton
            aria-label={removeLabel(detail ?? name)}
            onClick={() => onRemove(id)}
          />
        </li>
      ))}
    </ul>
  );
}
