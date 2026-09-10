"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";

// The wizard pulls in the whole task form; load that chunk on first open only.
const NewTaskWizard = dynamic(
  () => import("./new-task-wizard").then((module) => module.NewTaskWizard),
  { ssr: false },
);

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
 * workspace; the wizard closes itself.
 */
export function NewTaskWizardProvider({
  children,
}: NewTaskWizardProviderProps) {
  const [openCount, setOpenCount] = useState(0);

  const openNewTaskWizard = useCallback(() => {
    setOpenCount((count) => count + 1);
  }, []);

  return (
    <NewTaskWizardContext value={{ openNewTaskWizard }}>
      {children}
      {openCount > 0 ? (
        <NewTaskWizard key={openCount} instance={openCount} />
      ) : null}
    </NewTaskWizardContext>
  );
}
