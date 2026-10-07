"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import OAuthClientBackLink from "@/auth/components/oauth-client-back-link";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { claimSignUpConversion } from "@/lib/actions/auth/action";
import { authClient } from "@/lib/auth/auth.client";
import {
  isRejectedOAuthRequestError,
  oauthRequestExpiresSoon,
} from "@/lib/auth/auth.utils";
import type {
  OAuthRequestAccount,
  OAuthRequestClient,
} from "@/lib/auth/oauth-request.server";
import { signOutWithPushRelease } from "@/lib/auth/sign-out.client";
import { fireGTMEvent } from "@/lib/gtm-events";

interface OAuthHandBackProps {
  /** The signed OAuth request the page carries. */
  oauthQuery: string;
  /** The product the person is continuing to, when Core could name it. */
  client?: OAuthRequestClient | undefined;
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

  function handBack(checkAccount?: () => Promise<boolean>) {
    // StrictMode mounts twice in development, and a person can press twice.
    // A second hand-back would issue a second authorization code.
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    // A social sign-up made during an OAuth request never reaches
    // /auth/callback/signup: Core sends it here instead. Count it before the
    // provider's answer navigates away (apps/web/TRACKING.md).
    claimSignUpConversion()
      .then((provider) => {
        if (provider) {
          fireGTMEvent.signUp(provider);
        }
      })
      .catch(() => undefined)
      .then(async () => {
        // Another tab can replace a confirmed account while the claim waits.
        if (checkAccount && !(await checkAccount())) {
          hasStarted.current = false;
          return;
        }
        const result = await authClient.oauth2.continue({
          created: true,
          oauth_query: oauthQuery,
        });
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

function AutomaticHandBack({ oauthQuery, client }: HandBackRequest) {
  const t = useTranslations("Auth.OAuthHandBack");
  const clientName = client?.name;
  const { hasFailed, handBack } = useHandBack(oauthQuery);

  useMountEffect(handBack);

  if (hasFailed) {
    return <OAuthRequestError client={client} />;
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
  client,
  account,
}: HandBackRequest & { account: OAuthRequestAccount }) {
  const t = useTranslations("Auth.OAuthHandBack");
  const clientName = client?.name;
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

    async function checkAccount() {
      // Recheck before changing auth and after the conversion claim waits.
      try {
        const result = await authClient.getSession({
          query: { disableCookieCache: true },
        });
        if (result.error) throw result.error;
        if (result.data?.user.id !== account.id) {
          router.refresh();
          chooseAgain();
          return false;
        }
        return true;
      } catch {
        toast.error(t("accountCheckError"));
        chooseAgain();
        return false;
      }
    }
    if (!(await checkAccount())) return;

    if (choice === "continue") {
      handBack(checkAccount);
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
    return <OAuthRequestError client={client} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        {client ? <OAuthClientBackLink client={client} /> : null}
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
          loading={pendingChoice === "continue"}
          onClick={handleContinue}
        >
          {t("continueAs", { account: account.name.trim() || account.email })}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pendingChoice !== null}
          loading={pendingChoice === "switch"}
          onClick={handleUseAnotherAccount}
        >
          {t("useAnotherAccount")}
        </Button>
      </div>
    </div>
  );
}

interface OAuthRequestErrorProps {
  /** The product to go back to, when Core could name it. */
  client?: OAuthRequestClient | undefined;
}

/**
 * The signed request is no longer accepted: it expired, or Core refused it.
 * The person starts again from the product.
 */
export function OAuthRequestError({ client }: OAuthRequestErrorProps) {
  const t = useTranslations("Auth.OAuthHandBack");
  const clientName = client?.name;

  return (
    <div role="alert" className="flex flex-1 flex-col gap-2 p-6">
      {client ? <OAuthClientBackLink client={client} /> : null}
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
      {!client?.uri ? (
        <Link
          href="/"
          className="self-start rounded-md py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          {t("backToSokosumi")}
        </Link>
      ) : null}
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
