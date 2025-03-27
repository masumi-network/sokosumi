import { useTranslations } from "next-intl";

export default function Dashboard() {
  const t = useTranslations("Dashboard");

  return (
    <div className="flex items-center justify-center gap-16 p-8 sm:p-20">
      <h1>{t("title")}</h1>
    </div>
  );
}
