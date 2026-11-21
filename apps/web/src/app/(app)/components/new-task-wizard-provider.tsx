"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import type { NewTaskCopyPrefill } from "@/app/tasks/components/create-task-modal";
import {
  loadNewTaskWizard,
  usePrefetchNewTaskWizard,
} from "@/hooks/effects/use-prefetch-new-task-wizard";

const NewTaskWizard = dynamic(
  () => loadNewTaskWizard().then((module) => module.NewTaskWizard),
  { ssr: false },
);

/** What a caller can prefill, and hear back, when it opens the wizard. */
export interface NewTaskWizardOptions {
  projectId?: string | null;
  prompt?: string | null;
  assigneeId?: string | null;
  /** Further prefill for a copy of an existing Task ("Duplicate"). */
  copy?: NewTaskCopyPrefill;
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

  usePrefetchNewTaskWizard();

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
          initialCopy={options.copy ?? null}
          onTaskCreated={options.onTaskCreated}
          onClose={closeNewTaskWizard}
        />
      ) : null}
    </NewTaskWizardContext>
  );
}
