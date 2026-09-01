export function taskAssigneeFormLabels(t: {
  (
    key:
      | "assignee"
      | "assigneeUnassigned"
      | "assigneeMe"
      | "assigneePeople"
      | "assigneeCoworkers"
      | "assigneePersonalAssistants"
      | "assigneeSearchPlaceholder"
      | "assigneeEmptyResults",
  ): string;
}): {
  assignee: string;
  assigneeUnassigned: string;
  assigneeMe: string;
  assigneePeople: string;
  assigneeCoworkers: string;
  assigneePersonalAssistants: string;
  assigneeSearchPlaceholder: string;
  assigneeEmptyResults: string;
} {
  return {
    assignee: t("assignee"),
    assigneeUnassigned: t("assigneeUnassigned"),
    assigneeMe: t("assigneeMe"),
    assigneePeople: t("assigneePeople"),
    assigneeCoworkers: t("assigneeCoworkers"),
    assigneePersonalAssistants: t("assigneePersonalAssistants"),
    assigneeSearchPlaceholder: t("assigneeSearchPlaceholder"),
    assigneeEmptyResults: t("assigneeEmptyResults"),
  };
}
