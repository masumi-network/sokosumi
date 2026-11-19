import type { ProjectActivityItem } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { getNotificationHref } from "@/lib/utils/notification-href";
import {
  WorkspaceColumnProjectAvatar,
  WorkspaceColumnRow,
} from "./workspace-column-row";

function describeActivity(
  item: ProjectActivityItem,
  t: ReturnType<typeof useTranslations<"App.Projects.column.activity">>,
) {
  switch (item.kind) {
    case "task":
      return {
        title: item.title,
        event: t("task", { status: item.status ?? "COMMENT" }),
        href: getNotificationHref({
          kind: "TASK",
          referenceId: item.taskId,
          metadata: null,
        }),
      };
    case "job":
      return {
        title: item.title ?? t("untitledJob"),
        event: t("job", { status: item.status }),
        href: getNotificationHref({
          kind: "JOB",
          referenceId: item.jobId,
          metadata: { agentId: item.agentId },
        }),
      };
    case "project":
      return {
        title: item.project.name,
        event: t("project", { event: item.event }),
        href: getNotificationHref({
          kind: "PROJECT",
          referenceId: item.project.id,
          metadata: null,
        }),
      };
  }
}

export function ProjectActivityRow({
  item,
  time,
  inProjectPicker,
  onNavigate,
}: {
  item: ProjectActivityItem;
  time: string;
  inProjectPicker?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("App.Projects.column.activity");
  const { title, event, href } = describeActivity(item, t);
  return (
    <WorkspaceColumnRow
      inProjectPicker={inProjectPicker}
      leading={
        <WorkspaceColumnProjectAvatar
          inProjectPicker={inProjectPicker}
          name={item.project.name}
          logo={item.project.logo}
        />
      }
      title={title}
      detail={
        item.kind === "project"
          ? event
          : t("detail", { project: item.project.name, event })
      }
      time={time}
      target={{ href, onNavigate }}
    />
  );
}
