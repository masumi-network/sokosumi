import { useTranslations } from "next-intl";

import { KanjiLogo, ThemedLogo } from "@/components/masumi-logos";

import AgentsShowcase from "./agents-showcase";

export default function Hero() {
  const t = useTranslations("Landing.Page.Hero");
  return (
    <>
      <div className="landing-hero-bg blur-in absolute inset-0 z-0 h-full w-full" />
      <div className="container h-full px-12 md:px-6">
        <div className="relative z-1 flex flex-col items-center gap-6 text-center">
          <div className="w-full">
            <h1 className="text-center text-7xl font-bold whitespace-pre-line">
              {t("title")}
            </h1>
          </div>
          <div className="w-full">
            <p className="text-foreground/80 text-xl font-normal md:whitespace-pre-line">
              {t("caption")}
            </p>
          </div>
        </div>
        <AgentsShowcase />
      </div>
      <div className="absolute right-0 flex h-full w-full items-center justify-end p-12">
        <ThemedLogo LogoComponent={KanjiLogo} />
      </div>
    </>
  );
}
