"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";

// The wizard pulls in the whole task form, so it ships as its own chunk that
// is warmed once the shell is idle rather than on the shell's critical path.
const loadNewTaskWizard = () => import("./new-task-wizard");

const NewTaskWizard = dynamic(
  () => loadNewTaskWizard().then((module) => module.NewTaskWizard),
  { ssr: false },
);

function prefetchNewTaskWizardWhenIdle(): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(() => void loadNewTaskWizard(), {
      timeout: 2000,
    });
    return () => window.cancelIdleCallback(handle);
  }
  const timeout = window.setTimeout(() => void loadNewTaskWizard(), 2000);
  return () => window.clearTimeout(timeout);
}

/** What a caller can prefill, and hear back, when it opens the wizard. */
export interface NewTaskWizardOptions {
  projectId?: string | null;
  prompt?: string | null;
  assigneeId?: string | null;
  onTaskCreated?: (taskId: string) => void;
}

interface NewTaskWizardContextValue {
  openNewTaskWizard: (options?: NewTaskWizardOptions) => void;
}

const NewTaskWizardContext = createContext<NewTaskWizardContextValue | null>(
  null,
);

/**
 * Soft read for layout chrome that may SSR under the app Suspense fallback
 * (`AppShellLoadingFrame`) before `NewTaskWizardProvider` mounts — same
 * reason as `useOptionalHistorySearch`.
 */
export function useOptionalNewTaskWizard(): NewTaskWizardContextValue | null {
  return useContext(NewTaskWizardContext);
}

interface NewTaskWizardProviderProps {
  children: ReactNode;
}

/**
 * App-wide New Task wizard, opened in place from the sidebar. Every open
 * mounts a fresh wizard under a new instance number so its lists reload for
 * the current workspace; closing unmounts it so nothing keeps fetching
 * behind a closed modal.
 */
export function NewTaskWizardProvider({
  children,
}: NewTaskWizardProviderProps) {
  const [instance, setInstance] = useState(0);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<NewTaskWizardOptions>({});

  useMountEffect(prefetchNewTaskWizardWhenIdle);

  const openNewTaskWizard = useCallback((next?: NewTaskWizardOptions) => {
    setOptions(next ?? {});
    setInstance((current) => current + 1);
    setOpen(true);
  }, []);

  const closeNewTaskWizard = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <NewTaskWizardContext value={{ openNewTaskWizard }}>
      {children}
      {open ? (
        <NewTaskWizard
          key={instance}
          instance={instance}
          defaultProjectId={options.projectId ?? null}
          initialPrompt={options.prompt ?? null}
          initialAssigneeId={options.assigneeId ?? null}
          onTaskCreated={options.onTaskCreated}
          onClose={closeNewTaskWizard}
        />
      ) : null}
    </NewTaskWizardContext>
  );
}
