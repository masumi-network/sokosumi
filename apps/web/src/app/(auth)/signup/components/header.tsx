import { useTranslations } from "next-intl";

interface SignUpHeaderProps {
  invitationId?: string | undefined;
  /** The product that sent the person here through Sign in with Sokosumi. */
  clientName?: string | undefined;
}

export default function SignUpHeader({
  invitationId,
  clientName,
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
        {clientName
          ? t("descriptionFor", { client: clientName })
          : t("description")}
      </p>
    </div>
  );
}
