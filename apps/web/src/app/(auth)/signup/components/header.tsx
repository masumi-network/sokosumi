import { useTranslations } from "next-intl";

import OAuthClientBackLink from "@/auth/components/oauth-client-back-link";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";

interface SignUpHeaderProps {
  invitationId?: string | undefined;
  /** The product that sent the person here through Sign in with Sokosumi. */
  client?: OAuthRequestClient | undefined;
}

export default function SignUpHeader({
  invitationId,
  client,
}: SignUpHeaderProps) {
  const t = useTranslations("Auth.Pages.SignUp.Header");

  return (
    <div className="p-6">
      {client ? <OAuthClientBackLink client={client} /> : null}
      <div className="flex items-end gap-2">
        <h1 className="text-2xl font-light text-balance tracking-tight">
          {t("title")}
        </h1>
        {invitationId && (
          <p className="text-sm text-muted-foreground italic">
            {t("viaInvitation")}
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {client
          ? t("descriptionFor", { client: client.name })
          : t("description")}
      </p>
    </div>
  );
}
