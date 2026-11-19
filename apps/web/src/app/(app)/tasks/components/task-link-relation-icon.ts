import type { TaskLinkRelation } from "@sokosumi/core-client";
import type { LucideIcon } from "lucide-react";
import {
  OctagonMinus,
  SquareMinus,
  SquareMousePointer,
  SquaresExclude,
} from "lucide-react";

export function getTaskLinkRelationIcon(
  relation: TaskLinkRelation,
): LucideIcon {
  switch (relation) {
    case "related":
    // A PARENT link left from before sub-tasks reads as related, like the
    // ones the sub-task backfill turned into RELATES.
    case "parent":
    case "child":
      return SquareMousePointer;
    case "blocks":
      return OctagonMinus;
    case "blocked_by":
      return SquareMinus;
    case "duplicate":
      return SquaresExclude;
    default: {
      const _exhaustive: never = relation;
      return _exhaustive;
    }
  }
}
