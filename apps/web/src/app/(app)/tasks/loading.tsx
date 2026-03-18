import { TasksLoadingView } from "./components/tasks-loading-view";

export default function TasksLoading() {
  return (
    <div className="w-full px-2">
      <TasksLoadingView viewMode="board" />
    </div>
  );
}
