"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Toasts an error and closes `NewTaskWizardModal` when its options query enters
 * an error state.
 */
export function useNewTaskWizardLoadError(
  isError: boolean,
  handleClose: () => void,
  tTasksErrors: (key: "loadCreateTask") => string,
): void {
  useEffect(() => {
    if (!isError) return;
    toast.error(tTasksErrors("loadCreateTask"));
    handleClose();
  }, [handleClose, isError, tTasksErrors]);
}
