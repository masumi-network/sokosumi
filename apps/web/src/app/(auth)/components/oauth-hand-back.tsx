"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth/auth.client";
import {
  isRejectedOAuthRequestError,
  oauthRequestExpiresSoon,
} from "@/lib/auth/auth.utils";
import type { OAuthRequestAccount } from "@/lib/auth/oauth-request.server";
import { signOutWithPushRelease } from "@/lib/auth/sign-out.client";

interface OAuthHandBackProps {
  /** The signed OAuth request the page carries. */
  oauthQuery: string;
  /** The product the person is continuing to, when Core could name it. */
  clientName?: string | undefined;
  /**
   * Ask whether to continue as this account, or use another one, before the
   * request goes back. Without it the request goes back at once.
   */
  accountToConfirm?: OAuthRequestAccount | undefined;
}

/**
 * Shown in place of the sign-in or sign-up form to a person who is already
 * signed in and carries an OAuth request: hands the request back to Core's
 * OAuth provider, which answers with where to go next.
 *
 * It never navigates itself. Better Auth's client follows the provider's
 * `{ redirect: true, url }`, and a second navigation would deliver the
 * authorization code twice, for which Core revokes a confidential client's
 * tokens.
 */
export default function OAuthHandBack({
  accountToConfirm,
  ...request
}: OAuthHandBackProps) {
  return accountToConfirm ? (
    <AccountChoice
      key={`${request.oauthQuery}:${accountToConfirm.id}`}
      {...request}
      account={accountToConfirm}
    />
  ) : (
    <AutomaticHandBack {...request} />
  );
}

type HandBackRequest = Omit<OAuthHandBackProps, "accountToConfirm">;

function useHandBack(oauthQuery: string) {
  const [hasFailed, setHasFailed] = useState(false);
  const hasStarted = useRef(false);

  function handBack() {
    // StrictMode mounts twice in development, and a person can press twice.
    // A second hand-back would issue a second authorization code.
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    authClient.oauth2
      .continue({ created: true, oauth_query: oauthQuery })
      .then((result) => {
        if (result.error || !(result.data?.redirect && result.data.url)) {
          setHasFailed(true);
        }
      })
      .catch(() => {
        setHasFailed(true);
      });
  }

  return { hasFailed, handBack, fail: () => setHasFailed(true) };
}

function AutomaticHandBack({ oauthQuery, clientName }: HandBackRequest) {
  const t = useTranslations("Auth.OAuthHandBack");
  const { hasFailed, handBack } = useHandBack(oauthQuery);

  useMountEffect(handBack);

  if (hasFailed) {
    return <HandBackError clientName={clientName} />;
  }

  return (
    <div
      role="status"
      className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-muted-foreground"
    >
      <Spinner />
      {clientName ? t("continuingTo", { client: clientName }) : t("continuing")}
    </div>
  );
}

function AccountChoice({
  oauthQuery,
  clientName,
  account,
}: HandBackRequest & { account: OAuthRequestAccount }) {
  const t = useTranslations("Auth.OAuthHandBack");
  const router = useRouter();
  const { hasFailed, handBack, fail } = useHandBack(oauthQuery);
  const [pendingChoice, setPendingChoice] = useState<
    "continue" | "switch" | null
  >(null);

  const choiceStarted = useRef(false);

  async function handleChoice(choice: "continue" | "switch") {
    if (choiceStarted.current) return;
    if (choice === "switch" && oauthRequestExpiresSoon(oauthQuery)) {
      fail();
      return;
    }
    choiceStarted.current = true;
    setPendingChoice(choice);
    function chooseAgain() {
      choiceStarted.current = false;
      setPendingChoice(null);
    }

    // Another tab can replace the session after this account was rendered.
    // Recheck before confirming it or signing it out.
    try {
      const result = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      if (result.error) throw result.error;
      if (result.data?.user.id !== account.id) {
        router.refresh();
        chooseAgain();
        return;
      }
    } catch {
      toast.error(t("accountCheckError"));
      chooseAgain();
      return;
    }

    if (choice === "continue") {
      handBack();
      return;
    }
    // Account validation also consumes request lifetime.
    if (oauthRequestExpiresSoon(oauthQuery)) {
      fail();
      return;
    }
    const signOutFailed = () => {
      toast.error(t("signOutError"));
      chooseAgain();
    };
    signOutWithPushRelease(account.id, {
      fetchOptions: {
        // Always validate this exact request, including a missing or invalid
        // parameter manifest that the client plugin would otherwise omit.
        body: { oauth_query: oauthQuery },
        onSuccess: () => router.refresh(),
        onError: ({ error }) =>
          isRejectedOAuthRequestError(error) ? fail() : signOutFailed(),
      },
    }).catch(signOutFailed);
  }

  function handleContinue() {
    void handleChoice("continue");
  }

  function handleUseAnotherAccount() {
    void handleChoice("switch");
  }

  if (hasFailed) {
    return <HandBackError clientName={clientName} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-light text-balance tracking-tight">
          {clientName
            ? t("chooseAccountTitleFor", { client: clientName })
            : t("chooseAccountTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t.rich("signedInAs", {
            email: account.email,
            account: (chunks: ReactNode) => (
              <span className="font-medium text-foreground">{chunks}</span>
            ),
          })}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="primary"
          className="w-full"
          disabled={pendingChoice !== null}
          onClick={handleContinue}
        >
          {pendingChoice === "continue" && <Spinner />}
          {t("continueAs", { account: account.name.trim() || account.email })}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pendingChoice !== null}
          onClick={handleUseAnotherAccount}
        >
          {pendingChoice === "switch" && <Spinner />}
          {t("useAnotherAccount")}
        </Button>
      </div>
    </div>
  );
}

function HandBackError({ clientName }: { clientName?: string | undefined }) {
  const t = useTranslations("Auth.OAuthHandBack");

  return (
    <div role="alert" className="flex flex-1 flex-col gap-2 p-6">
      <h1 className="text-2xl font-light text-balance tracking-tight">
        {clientName
          ? t("errorTitleFor", { client: clientName })
          : t("errorTitle")}
      </h1>
      <p className="text-sm text-muted-foreground">
        {clientName
          ? t("errorDescriptionFor", { client: clientName })
          : t("errorDescription")}
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <Loader2
      aria-hidden="true"
      className="size-4 animate-spin motion-reduce:animate-pulse"
    />
  );
}
