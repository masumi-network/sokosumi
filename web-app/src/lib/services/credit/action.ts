"use server";

import { getSessionOrThrow } from "@/lib/auth/utils";

import { getCredits } from "./service";

export async function getCreditsAction() {
  const session = await getSessionOrThrow();
  return await getCredits(session.user.id);
}
