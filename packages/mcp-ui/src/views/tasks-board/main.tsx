import { mountView } from "../../shell/mount.tsx";
import { BOARD_EMPTY, TasksBoard, TasksList } from "./TasksBoard.tsx";

mountView("tasks-board", {
  schema: TasksList,
  isEmpty: (data) => data.data.length === 0,
  empty: BOARD_EMPTY,
  refreshTool: "tasks_list",
  displayModes: ["inline", "fullscreen"],
  children: (data, context) => <TasksBoard data={data} context={context} />,
});
