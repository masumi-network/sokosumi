import { mountView } from "../../shell/mount.tsx";
import { TaskDetail, TaskResult } from "./TaskDetail.tsx";

mountView("task-detail", {
  schema: TaskResult,
  refreshTool: "tasks_get",
  children: (data, context) => <TaskDetail data={data} context={context} />,
});
