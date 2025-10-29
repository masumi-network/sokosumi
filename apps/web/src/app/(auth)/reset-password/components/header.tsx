import { useTranslations } from "next-intl";

export default function ResetPasswordHeader() {
  const t = useTranslations("Auth.Pages.ResetPassword");

  return (
    <div className="space-y-2 p-6">
      <h1 className="text-2xl font-light tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground text-sm">{t("description")}</p>
    </div>
  );
}
