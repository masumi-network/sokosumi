"use client";

import { createContext, useContext } from "react";

import type { HeaderProps } from "./header";

const JobsHeaderContext = createContext<HeaderProps | null>(null);

interface JobsHeaderProviderProps {
  value: HeaderProps;
  children: React.ReactNode;
}

export function JobsHeaderProvider({
  value,
  children,
}: JobsHeaderProviderProps) {
  return (
    <JobsHeaderContext.Provider value={value}>
      {children}
    </JobsHeaderContext.Provider>
  );
}

export function useJobsHeader() {
  return useContext(JobsHeaderContext);
}
