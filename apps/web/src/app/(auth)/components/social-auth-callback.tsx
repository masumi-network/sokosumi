"use client";

import { useSocialAuthCallback } from "@/hooks/effects/use-social-auth-callback";

interface SocialAuthCallbackProps {
  eventType: "signUp" | "signIn";
}

export default function SocialAuthCallback({
  eventType,
}: SocialAuthCallbackProps) {
  useSocialAuthCallback(eventType);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="border-foreground size-8 animate-spin motion-reduce:animate-pulse rounded-full border-4 border-t-transparent" />
    </div>
  );
}
