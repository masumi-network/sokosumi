import { useTranslations } from "next-intl";

export default function ForgotPasswordHeader() {
  const t = useTranslations("LandingAuth.Pages.ForgotPassword.Header");

  return (
    <div className="space-y-2 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground text-sm">{t("description")}</p>
    </div>
  );
}
