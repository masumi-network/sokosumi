import type { TaskLinkRelation } from "@sokosumi/core-client";
import type { LucideIcon } from "lucide-react";
import {
  OctagonMinus,
  SquareArrowRightEnter,
  SquareMinus,
  SquareMousePointer,
  SquaresExclude,
} from "lucide-react";

export function getTaskLinkRelationIcon(
  relation: TaskLinkRelation,
): LucideIcon {
  switch (relation) {
    case "related":
      return SquareMousePointer;
    case "blocks":
      return OctagonMinus;
    case "blocked_by":
      return SquareMinus;
    case "parent":
    case "child":
      return SquareArrowRightEnter;
    case "duplicate":
      return SquaresExclude;
    default: {
      const _exhaustive: never = relation;
      return _exhaustive;
    }
  }
}
