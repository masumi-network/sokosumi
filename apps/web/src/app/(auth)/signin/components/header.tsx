import { useTranslations } from "next-intl";

interface SignInHeaderProps {
  /** The product that sent the person here through Sign in with Sokosumi. */
  clientName?: string | undefined;
}

export default function SignInHeader({ clientName }: SignInHeaderProps) {
  const t = useTranslations("Auth.Pages.SignIn.Header");

  return (
    <div className="p-6">
      <h1 className="text-2xl font-light text-balance tracking-tight">
        {t("title")}
      </h1>
      <p className="text-sm text-muted-foreground">
        {clientName
          ? t("descriptionFor", { client: clientName })
          : t("description")}
      </p>
    </div>
  );
}
