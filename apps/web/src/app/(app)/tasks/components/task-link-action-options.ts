import { TaskLinkRelation } from "@sokosumi/core-client";
import { OctagonMinus, SquareMinus, SquareMousePointer } from "lucide-react";
import type { useTranslations } from "next-intl";

import { getTaskLinkRelationIcon } from "./task-link-relation-icon";
import type { TaskLinkActionOption } from "./task-link-task-picker-dialog";

export function buildTaskPickerOptions(
  tDetailActions: ReturnType<typeof useTranslations>,
): TaskLinkActionOption[] {
  return [
    {
      id: "related",
      label: tDetailActions("relations.related"),
      relation: TaskLinkRelation.RELATED,
      icon: getTaskLinkRelationIcon(TaskLinkRelation.RELATED),
    },
    {
      id: "blocks",
      label: tDetailActions("relations.blocks"),
      relation: TaskLinkRelation.BLOCKS,
      icon: getTaskLinkRelationIcon(TaskLinkRelation.BLOCKS),
    },
    {
      id: "blocked-by",
      label: tDetailActions("relations.blockedBy"),
      relation: TaskLinkRelation.BLOCKED_BY,
      icon: getTaskLinkRelationIcon(TaskLinkRelation.BLOCKED_BY),
    },
    {
      id: "duplicate",
      label: tDetailActions("relations.duplicate"),
      relation: TaskLinkRelation.DUPLICATE,
      icon: getTaskLinkRelationIcon(TaskLinkRelation.DUPLICATE),
    },
  ];
}

export function buildCreateRelatedOptions(
  tDetailActions: ReturnType<typeof useTranslations>,
): TaskLinkActionOption[] {
  return [
    {
      id: "related",
      label: tDetailActions("relations.related"),
      relation: TaskLinkRelation.RELATED,
      icon: SquareMousePointer,
    },
    {
      id: "blocks",
      label: tDetailActions("relations.blocks"),
      relation: TaskLinkRelation.BLOCKS,
      icon: OctagonMinus,
    },
    {
      id: "blocked-by",
      label: tDetailActions("relations.blockedBy"),
      relation: TaskLinkRelation.BLOCKED_BY,
      icon: SquareMinus,
    },
  ];
}
