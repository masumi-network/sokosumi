export function taskAssigneeFormLabels(t: {
  (
    key:
      | "assignee"
      | "assigneeUnassigned"
      | "assigneePeople"
      | "assigneeCoworkers"
      | "assigneeSearchPlaceholder"
      | "assigneeEmptyResults",
  ): string;
}): {
  assignee: string;
  assigneeUnassigned: string;
  assigneePeople: string;
  assigneeCoworkers: string;
  assigneeSearchPlaceholder: string;
  assigneeEmptyResults: string;
} {
  return {
    assignee: t("assignee"),
    assigneeUnassigned: t("assigneeUnassigned"),
    assigneePeople: t("assigneePeople"),
    assigneeCoworkers: t("assigneeCoworkers"),
    assigneeSearchPlaceholder: t("assigneeSearchPlaceholder"),
    assigneeEmptyResults: t("assigneeEmptyResults"),
  };
}
