"use client";

import { useEffect } from "react";

import { resetScopeDialogs } from "@/app/components/project-scope/sidebar-project-scope-state";

export function useSidebarScopeMobileReset(): void {
  // The store outlives this chip, as when the reader leaves the app shell.
  useEffect(() => resetScopeDialogs, []);
}
