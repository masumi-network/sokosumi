"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Monitor, Smartphone } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth/auth.client";
import {
  listMySessions,
  signOutMySession,
} from "@/lib/services/user-sessions.browser";
import {
  getBrowserFromUserAgent,
  getOSFromUserAgent,
  type OS,
} from "@/lib/utils/user-agent";

const OS_NAMES: Record<OS, string | null> = {
  "Windows Phone": "Windows Phone",
  Windows: "Windows",
  Android: "Android",
  Linux: "Linux",
  iOS: "iOS",
  MacOS: "macOS",
  Unknown: null,
};

export function SignedInDevices() {
  const t = useTranslations("App.Account.SignedInDevices");
  const formatter = useFormatter();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const busy = revokingId !== null || revokingOthers;

  const sessionsQuery = useQuery({
    queryKey: ["account", "sessions"],
    queryFn: listMySessions,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const sessions = [...(sessionsQuery.data ?? [])].sort(
    (left, right) =>
      Number(right.current) - Number(left.current) ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const hasOthers = sessions.some((session) => !session.current);

  function deviceLabel(userAgent?: string | null) {
    const browser = getBrowserFromUserAgent(userAgent ?? "");
    const os = OS_NAMES[getOSFromUserAgent(userAgent ?? "").os];
    if (browser && os) return t("deviceLabel", { browser, os });
    return browser ?? os ?? t("unknownDevice");
  }

  async function handleSignOut(sessionId: string) {
    setRevokingId(sessionId);
    try {
      await signOutMySession(sessionId);
      await sessionsQuery.refetch();
      toast.success(t("signedOut"));
    } catch {
      toast.error(t("signOutError"));
    } finally {
      setRevokingId(null);
    }
  }

  async function handleSignOutOthers() {
    setRevokingOthers(true);
    try {
      const result = await authClient.revokeOtherSessions();
      if (result.error) {
        toast.error(t("signOutError"));
        return;
      }
      setConfirmOpen(false);
      await sessionsQuery.refetch();
      toast.success(t("signedOutOthers"));
    } catch {
      toast.error(t("signOutError"));
    } finally {
      setRevokingOthers(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription>
          {t.rich("description", {
            link: (chunks) => (
              <Link
                href="/account/notifications"
                className="text-foreground underline underline-offset-4"
              >
                {chunks}
              </Link>
            ),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sessionsQuery.isPending ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
            {t("loading")}
          </div>
        ) : sessionsQuery.isError ? (
          <div className="rounded-lg border border-dashed px-4 py-3">
            <p className="text-sm">{t("loadError")}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              loading={sessionsQuery.isFetching}
              onClick={() => {
                void sessionsQuery.refetch();
              }}
            >
              {t("retry")}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {sessions.map((session) => {
              const label = deviceLabel(session.userAgent);
              const isCurrent = session.current;
              const Icon = getOSFromUserAgent(session.userAgent ?? "").isMobile
                ? Smartphone
                : Monitor;
              return (
                <li
                  key={session.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="min-w-0 break-words">{label}</span>
                        {isCurrent ? (
                          <Badge variant="muted">{t("thisDevice")}</Badge>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t("signedInAt", {
                          date: formatter.dateTime(
                            new Date(session.createdAt),
                            "dateTimeMedium",
                          ),
                        })}
                      </p>
                    </div>
                  </div>
                  {isCurrent ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={busy}
                      loading={revokingId === session.id}
                      aria-label={t("signOutDevice", { device: label })}
                      onClick={() => {
                        void handleSignOut(session.id);
                      }}
                    >
                      {t("signOut")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {hasOthers ? (
        <CardFooter>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="ms-auto"
                disabled={busy}
              >
                {t("signOutOthers")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("confirmDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={revokingOthers}>
                  {t("cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  loading={revokingOthers}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleSignOutOthers();
                  }}
                >
                  {t("confirmSignOut")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      ) : null}
    </Card>
  );
}
