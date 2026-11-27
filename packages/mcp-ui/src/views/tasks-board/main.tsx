import { mountView } from "../../shell/mount.tsx";
import {
  BOARD_EMPTY,
  BOARD_REFRESH_ARGS,
  TasksBoard,
  TasksList,
} from "./TasksBoard.tsx";

mountView("tasks-board", {
  skeleton: "cards",
  schema: TasksList,
  isEmpty: (data) => data.data.length === 0,
  empty: BOARD_EMPTY,
  refreshTool: "tasks_list",
  refreshArgs: BOARD_REFRESH_ARGS,
  displayModes: ["inline", "fullscreen"],
  children: (data, context) => <TasksBoard data={data} context={context} />,
});
