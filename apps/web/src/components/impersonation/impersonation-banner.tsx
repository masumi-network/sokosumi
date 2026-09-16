import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";

import { ImpersonationBannerExit } from "./impersonation-banner-exit.client";

interface ImpersonationBannerProps {
  name: string;
  email: string;
  impersonatedBy: string | null | undefined;
}

/**
 * Persistent "Acting as …" strip above the app header while an admin
 * impersonates a user. Renders nothing without the impersonation marker.
 * The frame mounts this unconditionally so Exit stays reachable on every
 * page, including admin pages that refuse the impersonated (non-admin)
 * session.
 */
export async function ImpersonationBanner({
  name,
  email,
  impersonatedBy,
}: ImpersonationBannerProps) {
  if (!impersonatedBy) {
    return null;
  }

  const t = await getTranslations("App.Impersonation");

  return (
    <div
      role="alert"
      data-testid="impersonation-banner"
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2",
        "border-semantic-warning-tertiary bg-semantic-warning-quinary text-semantic-warning",
      )}
    >
      <Users className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">
        {t("banner", { name, email })}
      </p>
      <ImpersonationBannerExit
        label={t("exit")}
        errorMessage={t("stopError")}
        className="border-semantic-warning-tertiary bg-transparent text-semantic-warning hover:bg-semantic-warning-quinary hover:text-semantic-warning"
      />
    </div>
  );
}
