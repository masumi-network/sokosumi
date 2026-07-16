import type { LucideIcon } from "lucide-react";
import {
  OctagonMinus,
  SquareArrowRightEnter,
  SquareMinus,
  SquareMousePointer,
  SquaresExclude,
} from "lucide-react";

import type { TaskLinkRelation } from "@/lib/clients/generated/core";

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
  }
}
