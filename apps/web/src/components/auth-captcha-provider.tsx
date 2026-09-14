"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useLocale, useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getEnvPublicConfig } from "@/config/env.public";
import { useMountEffect } from "@/hooks/use-mount-effect";

interface CaptchaFetchOptions {
  headers?: { "x-captcha-response": string };
}

export type RequestAuthCaptcha = () => Promise<CaptchaFetchOptions | null>;

const AuthCaptchaContext = createContext<RequestAuthCaptcha | null>(null);

export function useAuthCaptcha(): RequestAuthCaptcha {
  const requestCaptcha = useContext(AuthCaptchaContext);
  if (!requestCaptcha) throw new Error("AuthCaptchaProvider is missing");
  return requestCaptcha;
}

export function AuthCaptchaProvider({ children }: { children: ReactNode }) {
  const siteKey = getEnvPublicConfig().NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const t = useTranslations("Components.AuthCaptcha");
  const locale = useLocale();
  const [challenge, setChallenge] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const sequence = useRef(0);
  const pending = useRef<{
    id: number;
    resolve: (value: CaptchaFetchOptions | null) => void;
  } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const finish = useCallback(
    (id: number, value: CaptchaFetchOptions | null) => {
      if (pending.current?.id !== id) return;
      const { resolve } = pending.current;
      pending.current = null;
      setChallenge(null);
      resolve(value);
    },
    [],
  );

  const requestCaptcha = useCallback<RequestAuthCaptcha>(() => {
    // Omitting the public site key skips the widget during local development.
    if (!siteKey) return Promise.resolve({});
    if (pending.current) return Promise.resolve(null);
    const id = ++sequence.current;
    setFailed(false);
    setChallenge(id);
    return new Promise((resolve) => {
      pending.current = { id, resolve };
    });
  }, [siteKey]);

  useEffect(() => {
    if (challenge === null) return;
    // Keep the dialog open for widget recovery or explicit cancellation.
    const timeout = setTimeout(() => setFailed(true), 30_000);
    return () => clearTimeout(timeout);
  }, [challenge]);

  useMountEffect(() => {
    // Forms can disable (and blur) Submit before async validation finishes.
    // Remember focus before that happens so cancelling returns to the form.
    function rememberFocus(event: FocusEvent) {
      if (
        !pending.current &&
        event.target instanceof HTMLElement &&
        event.target !== document.body
      ) {
        trigger.current = event.target;
      }
    }
    document.addEventListener("focusin", rememberFocus);
    return () => {
      document.removeEventListener("focusin", rememberFocus);
      pending.current?.resolve(null);
      pending.current = null;
    };
  });

  return (
    <AuthCaptchaContext value={requestCaptcha}>
      {children}
      {challenge !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && challenge !== null) finish(challenge, null);
          }}
        >
          <DialogContent
            showCloseButton={false}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              trigger.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            {siteKey && challenge !== null && (
              <Turnstile
                key={challenge}
                siteKey={siteKey}
                className="mx-auto"
                options={{ action: "auth", size: "compact", language: locale }}
                onSuccess={(token) =>
                  finish(challenge, {
                    headers: { "x-captcha-response": token },
                  })
                }
                onError={() => setFailed(true)}
                onTimeout={() => setFailed(true)}
                onUnsupported={() => setFailed(true)}
                scriptOptions={{ onError: () => setFailed(true) }}
              />
            )}
            {failed && (
              <p role="alert" className="text-destructive text-sm">
                {t("error")}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  if (challenge !== null) finish(challenge, null);
                }}
              >
                {t("cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </AuthCaptchaContext>
  );
}
