"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { fireGTMEvent } from "@/lib/gtm-events";
import { socialProviderIdSchema } from "@/lib/schemas/auth";
import {
  buildOAuthConsentReturnUrlFromSearchParams,
  getValidAuthRedirectUrl,
} from "@/lib/utils/auth-redirect";

interface SocialAuthCallbackProps {
  eventType: "signUp" | "signIn";
}

function getValidRedirectUrl(returnUrl: string | null): string {
  // Normalize root to /chat (our initial page) so social login matches credential behavior
  const normalized = returnUrl?.trim() || "";
  const url = normalized && normalized !== "/" ? normalized : undefined;
  return getValidAuthRedirectUrl(url, "/chat");
}

export default function SocialAuthCallback({
  eventType,
}: SocialAuthCallbackProps) {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("provider");
    const returnUrl =
      params.get("returnUrl") ??
      buildOAuthConsentReturnUrlFromSearchParams(params) ??
      null;
    const validationResult = socialProviderIdSchema.safeParse(provider);

    if (validationResult.success && validationResult.data !== "credential") {
      switch (eventType) {
        case "signUp":
          fireGTMEvent.signUp(validationResult.data);
          break;
        case "signIn":
          fireGTMEvent.signIn(validationResult.data);
          break;
      }
    }

    const redirectUrl = getValidRedirectUrl(returnUrl);
    router.replace(redirectUrl);
  }, [router, eventType]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="border-primary size-8 animate-spin rounded-full border-4 border-t-transparent" />
    </div>
  );
}
