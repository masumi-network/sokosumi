"use client";

import { CookieIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COOKIE_NAME = "cookie_consent";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`;
}

interface CookieConsentProps {
  onAccept?: (() => void) | undefined;
  onReject?: (() => void) | undefined;
}

export default function CookieConsent({
  onAccept,
  onReject,
}: CookieConsentProps) {
  const t = useTranslations("Components.CookieConsent");

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = getCookie(COOKIE_NAME);
    if (!consent) {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    setCookie(COOKIE_NAME, "accepted", COOKIE_MAX_AGE);
    // TODO: Initialize analytics or tracking here (only if accepted)
    setVisible(false);
    onAccept?.();
  };

  const handleReject = () => {
    setCookie(COOKIE_NAME, "rejected", COOKIE_MAX_AGE);
    // Optional: disable tracking or clear cookies here
    setVisible(false);
    onReject?.();
  };

  return (
    <div
      className={cn(
        "fixed right-0 bottom-0 left-0 z-[999999] p-2 transition-all duration-700 sm:max-w-md sm:p-4",
        visible ? "translate-y-0 opacity-100" : "translate-y-[100%] opacity-0",
      )}
    >
      <div className="bg-background space-y-2 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">{t("title")}</h3>
          <CookieIcon />
        </div>
        <p className="leading-4">
          <span className="text-muted-foreground text-xs">
            {t("description")}
          </span>
          <Link href="/privacy-policy" className="text-xs underline">
            {t("cookiePolicy")}
          </Link>
          <span>{t("period")}</span>
        </p>
        <div className="flex items-center gap-2 border-t pt-2">
          <Button onClick={handleAccept} size="sm">
            {t("accept")}
          </Button>
          <Button onClick={handleReject} variant="outline" size="sm">
            {t("reject")}
          </Button>
        </div>
      </div>
    </div>
  );
}
