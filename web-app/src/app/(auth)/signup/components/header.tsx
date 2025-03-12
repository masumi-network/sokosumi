import { useTranslations } from "next-intl";

export default function SignUpHeader() {
  const t = useTranslations("Auth.Pages.SignUp.Header");

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-gray-400">{t("description")}</p>
    </div>
  );
}
