import { useTranslations } from "next-intl";

import { KanjiLogo, ThemedLogo } from "@/components/masumi-logos";

import AgentsShowcase from "./agents-showcase";

export default function Hero() {
  const t = useTranslations("Landing.Page.Hero");
  return (
    <>
      <div className="relative flex flex-col items-center space-y-20 text-center">
        <div className="relative z-1 space-y-6">
          <div className="w-full">
            <h1 className="text-center font-sans text-7xl leading-[1.2] font-light tracking-[-0.02em] whitespace-pre-line">
              {t("title")}
            </h1>
          </div>

          <div className="w-full">
            <p className="text-foreground/80 text-xl font-normal md:whitespace-pre-line">
              {t("caption")}
            </p>
          </div>
        </div>
      </div>
      <AgentsShowcase />
      <div className="pointer-events-none absolute inset-0 right-0 flex h-full w-full items-center justify-end p-12">
        <ThemedLogo LogoComponent={KanjiLogo} />
      </div>
    </>
  );
}
