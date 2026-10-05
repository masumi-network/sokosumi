"use server";

import { patchUsersById } from "@sokosumi/core-client";
import { redirect, unstable_rethrow } from "next/navigation";

import { asSignedInPersonOrHome } from "../lib/core";
import { type PersonNameErrors, personNameErrors } from "../lib/person-name";

/** What the name form shows after a submit that did not finish. */
export interface NameFormState {
  /** Counts submits, so the form remounts with the values below. */
  attempt: number;
  firstName: string;
  lastName: string;
  errors: PersonNameErrors & { form?: string };
}

/**
 * The workspace gate's name step: Web's rule for the name, then Core saves
 * it (and makes it the display name when there is none).
 */
export async function saveName(
  previous: NameFormState,
  formData: FormData,
): Promise<NameFormState> {
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const result = { attempt: previous.attempt + 1, firstName, lastName };

  const errors = personNameErrors(firstName, lastName);
  if (errors.firstName || errors.lastName) return { ...result, errors };

  const asPerson = await asSignedInPersonOrHome();
  let status: number | null = null;
  try {
    const { response } = await patchUsersById({
      ...asPerson,
      path: { id: "me" },
      body: { firstName, lastName },
    });
    status = response?.status ?? null;
  } catch (error) {
    unstable_rethrow(error);
    console.error("Saving the name failed", error);
  }
  // 200: home now shows the workspace choice. 401: the token was revoked early.
  if (status === 200 || status === 401) redirect("/");

  return { ...result, errors: { form: "That did not work. Try again." } };
}
