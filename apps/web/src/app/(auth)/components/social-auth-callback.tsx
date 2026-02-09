"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { fireGTMEvent } from "@/lib/gtm-events";
import { socialProviderIdSchema } from "@/lib/schemas/auth";

interface SocialAuthCallbackProps {
  eventType: "signUp" | "signIn";
}

export default function SocialAuthCallback({
  eventType,
}: SocialAuthCallbackProps) {
  const router = useRouter();

  useEffect(() => {
    const provider = new URLSearchParams(window.location.search).get(
      "provider",
    );
    const validationResult = socialProviderIdSchema.safeParse(provider);

    if (validationResult.success && validationResult.data !== "credential") {
      // Fire the appropriate GTM event based on whether it's sign-up or sign-in
      switch (eventType) {
        case "signUp":
          fireGTMEvent.signUp(validationResult.data);
          break;
        case "signIn":
          fireGTMEvent.signIn(validationResult.data);
          break;
      }
    }

    // Immediately redirect to root so the app handles routing
    router.replace("/");
  }, [router, eventType]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="border-primary size-8 animate-spin rounded-full border-4 border-t-transparent" />
    </div>
  );
}
