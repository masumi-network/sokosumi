import { TaskLinkRelation } from "@sokosumi/core-client";
import {
  OctagonMinus,
  SquareMinus,
  SquareMousePointer,
  SquarePlus,
} from "lucide-react";
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
      id: "subtask",
      label: tDetailActions("relations.subtask"),
      relation: TaskLinkRelation.CHILD,
      icon: getTaskLinkRelationIcon(TaskLinkRelation.PARENT),
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
      id: "add-subtask",
      label: tDetailActions("relations.addSubtask"),
      relation: TaskLinkRelation.PARENT,
      icon: SquarePlus,
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
