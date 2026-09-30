import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

interface SignUpHeaderProps {
  invitationId?: string | undefined;
  /** The product that sent the person here through Sign in with Sokosumi. */
  clientName?: string | undefined;
  /** Replaces the default description, e.g. once the email is known. */
  description?: ReactNode;
}

export default function SignUpHeader({
  invitationId,
  clientName,
  description,
}: SignUpHeaderProps) {
  const t = useTranslations("Auth.Pages.SignUp.Header");

  return (
    <div className="p-6">
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
        {description ??
          (clientName
            ? t("descriptionFor", { client: clientName })
            : t("description"))}
      </p>
    </div>
  );
}
