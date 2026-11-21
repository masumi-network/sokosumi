"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Monitor, Smartphone } from "lucide-react";
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
  getBrowserFromUserAgent,
  getOSFromUserAgent,
  type OS,
} from "@/lib/utils/user-agent";

interface DeviceSession {
  id: string;
  token: string;
  userAgent?: string | null;
  createdAt: Date | string;
}

const OS_NAMES: Record<OS, string | null> = {
  "Windows Phone": "Windows Phone",
  Windows: "Windows",
  Android: "Android",
  Linux: "Linux",
  iOS: "iOS",
  MacOS: "macOS",
  Unknown: null,
};

interface SignedInDevicesProps {
  /** The session this page was loaded with, shown as "This device". */
  currentSessionId: string | null;
}

export function SignedInDevices({ currentSessionId }: SignedInDevicesProps) {
  const t = useTranslations("App.Account.SignedInDevices");
  const formatter = useFormatter();
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const busy = revokingToken !== null || revokingOthers;

  const sessionsQuery = useQuery({
    queryKey: ["account", "sessions"],
    queryFn: async (): Promise<DeviceSession[]> => {
      const result = await authClient.listSessions();
      if (result.error) {
        throw new Error(result.error.message || "Failed to load sessions");
      }
      return result.data ?? [];
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const sessions = [...(sessionsQuery.data ?? [])].sort(
    (left, right) =>
      Number(right.id === currentSessionId) -
        Number(left.id === currentSessionId) ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const hasOthers = sessions.some((session) => session.id !== currentSessionId);

  function deviceLabel(userAgent?: string | null) {
    const browser = getBrowserFromUserAgent(userAgent ?? "");
    const os = OS_NAMES[getOSFromUserAgent(userAgent ?? "").os];
    if (browser && os) return t("deviceLabel", { browser, os });
    return browser ?? os ?? t("unknownDevice");
  }

  async function handleSignOut(token: string) {
    setRevokingToken(token);
    try {
      const result = await authClient.revokeSession({ token });
      if (result.error) {
        toast.error(t("signOutError"));
        return;
      }
      await sessionsQuery.refetch();
      toast.success(t("signedOut"));
    } catch {
      toast.error(t("signOutError"));
    } finally {
      setRevokingToken(null);
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
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
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
              const isCurrent = session.id === currentSessionId;
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
                        <span className="truncate">{label}</span>
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
                      loading={revokingToken === session.token}
                      aria-label={t("signOutDevice", { device: label })}
                      onClick={() => {
                        void handleSignOut(session.token);
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
