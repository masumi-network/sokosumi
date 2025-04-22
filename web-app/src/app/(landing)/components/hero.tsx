import { useTranslations } from "next-intl";

import AgentsShowcase from "./agents-showcase";

export default function Hero() {
  const t = useTranslations("Landing.Page.Hero");
  return (
    <>
      <div className="landing-hero-bg absolute h-full w-full" />
      <div className="z-10 container flex flex-col items-center gap-6 px-12 text-center md:px-6">
        <h1 className="w-full text-center text-7xl font-bold whitespace-pre-line">
          {t("title")}
        </h1>
        <p className="text-foreground/80 w-full text-xl font-normal md:whitespace-pre-line">
          {t("caption")}
        </p>
      </div>
      <AgentsShowcase />
    </>
  );
}
