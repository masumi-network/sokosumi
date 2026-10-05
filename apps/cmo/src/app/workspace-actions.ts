"use server";

import { postUsersByIdWorkspaces } from "@sokosumi/core-client";
import { normalizeWebsiteUrl } from "@sokosumi/utils";
import { redirect, unstable_rethrow } from "next/navigation";

import { WORKSPACE_FAILED_ERROR } from "../components/workspace-gate";
import { asSignedInPersonOrHome } from "../lib/core";

/**
 * The workspace gate's "Just me". An existing personal workspace (409) is
 * the goal too, so a double submit just lets the person in.
 */
export async function createPersonalWorkspace() {
  const asPerson = await asSignedInPersonOrHome();
  let status: number | null = null;
  try {
    const { response } = await postUsersByIdWorkspaces({
      ...asPerson,
      path: { id: "me" },
      body: { kind: "personal" },
    });
    status = response?.status ?? null;
  } catch (error) {
    // Preserve Next's control flow and request-time rendering signals.
    unstable_rethrow(error);
    console.error("Creating the personal workspace failed", error);
  }
  // Core refused the token (revoked early): home shows the signed-out page.
  if (status === 401) redirect("/");
  redirect(
    status === 201 || status === 409
      ? "/"
      : `/?error=${WORKSPACE_FAILED_ERROR}`,
  );
}

/** What the organization form shows after a submit that did not finish. */
export interface OrganizationFormState {
  /** Counts submits, so the form remounts with the values below. */
  attempt: number;
  name: string;
  websiteUrl: string;
  errors: { name?: string; websiteUrl?: string; form?: string };
}

/**
 * The workspace gate's organization step: the same name and website rules
 * as Core, then Core creates the organization and makes it preferred.
 */
export async function createOrganizationWorkspace(
  previous: OrganizationFormState,
  formData: FormData,
): Promise<OrganizationFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();
  const result = { attempt: previous.attempt + 1, name, websiteUrl };

  // Core's own rules for this body (user-workspace.schema.ts), checked here
  // so the person sees which field to fix.
  const errors: OrganizationFormState["errors"] = {};
  if (name.length < 2 || name.length > 50) {
    errors.name = "Use 2 to 50 characters.";
  }
  if (!normalizeWebsiteUrl(websiteUrl)) {
    errors.websiteUrl = "Enter a website, like acme.com.";
  }
  if (errors.name || errors.websiteUrl) return { ...result, errors };

  const asPerson = await asSignedInPersonOrHome();
  let status: number | null = null;
  try {
    const { response } = await postUsersByIdWorkspaces({
      ...asPerson,
      path: { id: "me" },
      body: { kind: "organization", name, websiteUrl },
    });
    status = response?.status ?? null;
  } catch (error) {
    unstable_rethrow(error);
    console.error("Creating the organization workspace failed", error);
  }
  // 201: Core made it preferred. 401: the token was revoked early.
  if (status === 201 || status === 401) redirect("/");

  return {
    ...result,
    errors: {
      form:
        status === 403
          ? "You have reached the limit of organizations."
          : "That did not work. Try again.",
    },
  };
}
