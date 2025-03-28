import { useTranslations } from "next-intl";

export default function CreateJobSection() {
  const t = useTranslations("App.Jobs.CreateJob");

  return (
    <div className="flex h-full min-h-[300px] flex-1 flex-col gap-2">
      <h1 className="text-xl font-bold">{t("title")}</h1>
      <div className="flex-1 rounded-md border p-2"></div>
    </div>
  );
}
