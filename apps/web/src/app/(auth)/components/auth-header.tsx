import { useTranslations } from "next-intl";

import type { AuthMode } from "@/auth/components/auth-flow";
import OAuthClientBackLink from "@/auth/components/oauth-client-back-link";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";

interface AuthHeaderProps {
  mode: AuthMode;
  /** The product that sent the person here through Sign in with Sokosumi. */
  client?: OAuthRequestClient | undefined;
  /** Register says when it came from an invitation. */
  invitationId?: string | undefined;
}

/** Log in's or Register's title, under a way back to the product that sent the person. */
export function AuthHeader({ mode, client, invitationId }: AuthHeaderProps) {
  const t = useTranslations(
    mode === "signIn" ? "Auth.Pages.SignIn.Header" : "Auth.Pages.SignUp.Header",
  );
  const signUpT = useTranslations("Auth.Pages.SignUp.Header");

  return (
    <div className="p-6">
      {client ? <OAuthClientBackLink client={client} /> : null}
      <div className="flex items-end gap-2">
        <h1 className="text-2xl font-light text-balance tracking-tight">
          {t("title")}
        </h1>
        {mode === "signUp" && invitationId ? (
          <p className="text-sm text-muted-foreground italic">
            {signUpT("viaInvitation")}
          </p>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {client
          ? t("descriptionFor", { client: client.name })
          : t("description")}
      </p>
    </div>
  );
}
