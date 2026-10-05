"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import type { RemovedSignInMethods } from "./use-email-code";

interface SignInMethodsRemovedDialogProps {
  /** Set while a code sign-in that removed them waits to leave. */
  removed: RemovedSignInMethods | null;
}

/**
 * Tells someone who just signed in with a code that their old password and
 * Google or Microsoft links are gone, before the page leaves. Better Auth
 * removes them when the address was unproven; nobody else would say so.
 */
export function SignInMethodsRemovedDialog({
  removed,
}: SignInMethodsRemovedDialogProps) {
  const t = useTranslations("Auth");
  // Disables both buttons; the hook leaves only once either way.
  const [leaving, setLeaving] = useState(false);

  function leave(to: "returnUrl" | "setPassword") {
    setLeaving(true);
    removed?.leave(to);
  }

  return (
    <AlertDialog
      open={removed !== null}
      onOpenChange={(open) => {
        // Escape reads as Continue; the person is signed in either way.
        if (!open) leave("returnUrl");
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("SignInMethodsRemoved.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("SignInMethodsRemoved.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={leaving}
            onClick={() => leave("returnUrl")}
          >
            {t("SignInMethodsRemoved.continue")}
          </Button>
          <Button
            variant="primary"
            disabled={leaving}
            onClick={() => leave("setPassword")}
          >
            {t("SignInMethodsRemoved.setPassword")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
