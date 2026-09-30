"use client";

import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";

import { useMagicLinkRequest } from "@/auth/components/use-magic-link-request";
import { Button } from "@/components/ui/button";

interface SignUpMagicLinkProps {
  /** Confirmed on the first step, so the link needs no typing here. */
  email: string;
  returnUrl: string | undefined;
}

export function SignUpMagicLink({ email, returnUrl }: SignUpMagicLinkProps) {
  const t = useTranslations("Auth.SocialButtons");
  const { captcha, isRequesting, sentTo, requestMagicLink } =
    useMagicLinkRequest(returnUrl);
  const wasSent = sentTo === email;

  return (
    <div className="flex flex-col gap-2">
      {captcha}
      <Button
        type="button"
        variant="secondary"
        className="text-foreground bg-senary hover:bg-quinary h-[50px] w-full justify-center gap-2 rounded-md border border-transparent px-4 py-2 text-sm font-normal shadow-none"
        disabled={isRequesting}
        onClick={() => {
          void requestMagicLink(email);
        }}
      >
        <Mail className="size-4" />
        {isRequesting
          ? t("magicLinkSubmitting")
          : wasSent
            ? t("magicLinkResend")
            : t("magicLinkSubmit")}
      </Button>
      {/* Always mounted: a status region announces only text that changes. */}
      <p role="status" className="text-muted-foreground text-center text-sm">
        {wasSent ? t("magicLinkSuccess") : null}
      </p>
    </div>
  );
}
