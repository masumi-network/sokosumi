"use client";

import type { TaskStatus } from "@sokosumi/core-client";
import {
  createContext,
  type ReactNode,
  useContext,
  useOptimistic,
} from "react";

type OptimisticTaskStatus = readonly [
  status: TaskStatus,
  showStatus: (status: TaskStatus) => void,
];

const TaskDetailStatusContext = createContext<OptimisticTaskStatus | null>(
  null,
);

/**
 * One status for the whole task page. The header menu and the Properties
 * panel sit in separate Suspense subtrees, so a change made in one shows in
 * the other only through this.
 */
export function TaskDetailStatusProvider({
  status,
  children,
}: {
  status: TaskStatus;
  children: ReactNode;
}) {
  const value = useOptimistic(status);
  return (
    <TaskDetailStatusContext.Provider value={value}>
      {children}
    </TaskDetailStatusContext.Provider>
  );
}

/**
 * The status to show, a setter to call inside the transition of a status
 * write, and whether the shown status differs from the saved one (a status
 * write is open somewhere on the page). React drops
 * the shown value when that transition ends: with the revalidated status, or
 * alone when the write failed. Outside a provider (the admin and developer
 * views) the value is local to the caller.
 */
export function useOptimisticTaskStatus(
  savedStatus: TaskStatus,
): readonly [...OptimisticTaskStatus, isChanging: boolean] {
  const local = useOptimistic(savedStatus);
  const [status, showStatus] = useContext(TaskDetailStatusContext) ?? local;
  return [status, showStatus, status !== savedStatus];
}
