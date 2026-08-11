"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { useCreateJobModalContext } from "./create-job-modal-context";

/**
 * Create-job form graph is heavy. Defer the modal chunk until the user opens
 * hire/create — browse-only agent detail stays lighter on first paint.
 * Stay mounted after first open so Dialog can animate closed.
 */
const CreateJobModal = dynamic(() => import("./create-job-modal"), {
  ssr: false,
});

export default function LazyCreateJobModal() {
  const { open } = useCreateJobModalContext();
  const [hasOpened, setHasOpened] = useState(false);

  // Render-time latch (same pattern as create-project-modal) — not an effect
  // that mirrors props into state.
  if (open && !hasOpened) {
    setHasOpened(true);
  }

  if (!hasOpened) {
    return null;
  }

  return <CreateJobModal />;
}
