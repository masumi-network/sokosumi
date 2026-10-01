import { useTranslations } from "next-intl";

import OAuthClientBackLink from "@/auth/components/oauth-client-back-link";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";

interface SignInHeaderProps {
  /** The product that sent the person here through Sign in with Sokosumi. */
  client?: OAuthRequestClient | undefined;
}

export default function SignInHeader({ client }: SignInHeaderProps) {
  const t = useTranslations("Auth.Pages.SignIn.Header");

  return (
    <div className="p-6">
      {client ? <OAuthClientBackLink client={client} /> : null}
      <h1 className="text-2xl font-light text-balance tracking-tight">
        {t("title")}
      </h1>
      <p className="text-sm text-muted-foreground">
        {client
          ? t("descriptionFor", { client: client.name })
          : t("description")}
      </p>
    </div>
  );
}
