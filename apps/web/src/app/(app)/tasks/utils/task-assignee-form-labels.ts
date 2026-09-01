export function taskAssigneeFormLabels(t: {
  (
    key:
      | "assignee"
      | "assigneeUnassigned"
      | "assigneeMe"
      | "assigneePeople"
      | "assigneeCoworkers"
      | "assigneeSearchPlaceholder"
      | "assigneeEmptyResults",
  ): string;
}): {
  assignee: string;
  assigneeUnassigned: string;
  assigneeMe: string;
  assigneePeople: string;
  assigneeCoworkers: string;
  assigneeSearchPlaceholder: string;
  assigneeEmptyResults: string;
} {
  return {
    assignee: t("assignee"),
    assigneeUnassigned: t("assigneeUnassigned"),
    assigneeMe: t("assigneeMe"),
    assigneePeople: t("assigneePeople"),
    assigneeCoworkers: t("assigneeCoworkers"),
    assigneeSearchPlaceholder: t("assigneeSearchPlaceholder"),
    assigneeEmptyResults: t("assigneeEmptyResults"),
  };
}
