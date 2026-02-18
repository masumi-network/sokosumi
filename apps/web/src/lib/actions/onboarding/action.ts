"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { chatUIEnabled } from "@/lib/flags/chat";
import { userService } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function completeOnboarding(): Promise<
  Result<{ redirectUrl: string }, ActionError>
> {
  try {
    // Mark onboarding as completed without creating anything
    await userService.markOnboardingCompleteForMe();

    revalidatePath("/");
    const isChatEnabled = await chatUIEnabled();
    return Ok({ redirectUrl: isChatEnabled ? "/chat" : "/agents" });
  } catch (error) {
    console.error("Error completing onboarding:", error);
    const t = await getTranslations("Onboarding.Actions.Errors");
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: error instanceof Error ? error.message : t("failedToComplete"),
    });
  }
}
