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
    const handle = window.requestIdleCallback(() => void loadNewTaskWizard());
    return () => window.cancelIdleCallback(handle);
  }
  const timeout = window.setTimeout(() => void loadNewTaskWizard(), 2000);
  return () => window.clearTimeout(timeout);
}

interface NewTaskWizardContextValue {
  openNewTaskWizard: () => void;
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
 * mounts a fresh wizard (keyed) so its lists reload for the current
 * workspace. Dismiss unmounts it so the options query does not keep
 * refetching behind a closed modal.
 */
export function NewTaskWizardProvider({
  children,
}: NewTaskWizardProviderProps) {
  const [openCount, setOpenCount] = useState(0);

  useMountEffect(prefetchNewTaskWizardWhenIdle);

  const openNewTaskWizard = useCallback(() => {
    setOpenCount((count) => count + 1);
  }, []);

  const closeNewTaskWizard = useCallback(() => {
    setOpenCount(0);
  }, []);

  return (
    <NewTaskWizardContext value={{ openNewTaskWizard }}>
      {children}
      {openCount > 0 ? (
        <NewTaskWizard
          key={openCount}
          instance={openCount}
          onClose={closeNewTaskWizard}
        />
      ) : null}
    </NewTaskWizardContext>
  );
}
