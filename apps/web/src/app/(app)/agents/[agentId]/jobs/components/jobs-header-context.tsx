"use client";

import { createContext, useContext } from "react";

import type { HeaderProps } from "./header";

export const JobsHeaderContext = createContext<HeaderProps | null>(null);

export function useJobsHeader() {
  return useContext(JobsHeaderContext);
}
