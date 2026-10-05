"use server";

import { postUsersByIdWorkspaces } from "@sokosumi/core-client";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";

import { WORKSPACE_FAILED_ERROR } from "../components/workspace-gate";
import { asSignedInPerson } from "../lib/core";

/**
 * The workspace gate's "Just me". An existing personal workspace (409) is
 * the goal too, so a double submit just lets the person in.
 */
export async function createPersonalWorkspace() {
  let status: number | null = null;
  try {
    const { response } = await postUsersByIdWorkspaces({
      ...(await asSignedInPerson(await headers())),
      path: { id: "me" },
      body: { kind: "personal" },
    });
    status = response?.status ?? null;
  } catch (error) {
    // Preserve Next's control flow and request-time rendering signals.
    unstable_rethrow(error);
    console.error("Creating the personal workspace failed", error);
  }
  redirect(
    status === 201 || status === 409
      ? "/"
      : `/?error=${WORKSPACE_FAILED_ERROR}`,
  );
}
