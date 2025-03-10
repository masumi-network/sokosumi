import { useTranslations } from "next-intl";

export default function Hero() {
  const t = useTranslations("Landing.Page.Hero");
  return (
    <>
      <div className="flex flex-col items-center space-y-4 text-center">
        <div className="space-y-6">
          {/* First text box */}
          <div className="w-full">
            <p className="text-5xl leading-tight font-normal text-slate-500 md:whitespace-pre-line">
              {t("caption")}
            </p>
          </div>

          {/* Second text box */}
          <div className="w-full">
            <p className="text-6xl font-bold">{t("title")}</p>
          </div>
        </div>
      </div>
    </>
  );
}
