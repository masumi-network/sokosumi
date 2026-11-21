import type { ReactNode } from "react";

import { CatchUpTabs } from "./components/catch-up-tabs";

/** The tabs live here, not in each page, so a tab's loading shell sits below them. */
export default function CatchUpLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CatchUpTabs />
      {children}
    </>
  );
}
