import Image from "next/image";
import { useTranslations } from "next-intl";

export default function HowItWorks() {
  const t = useTranslations("Landing.Page.HowItWorks");
  const steps = [
    {
      number: "01",
      title: t("Steps.SelectAndTest.title"),
      description: t("Steps.SelectAndTest.description"),
    },
    {
      number: "02",
      title: t("Steps.RunAndMonitor.title"),
      description: t("Steps.RunAndMonitor.description"),
    },
    {
      number: "03",
      title: t("Steps.GetResults.title"),
      description: t("Steps.GetResults.description"),
    },
  ];

  return (
    <div className="relative">
      <div className="container mx-auto">
        <h2 className="mb-12 text-5xl font-light tracking-tight">
          {t("title")}
        </h2>

        <div className="relative flex w-full flex-col gap-6 lg:flex-row">
          <div className="max-w-[327px] space-y-8 py-20 pt-10 md:pt-20">
            {steps.map((step) => (
              <div key={step.number} className="space-y-3">
                <div className="text-foreground flex items-center gap-2 text-lg">
                  <span className="font-light">{step.number}</span>
                  <span className="font-bold">{step.title}</span>
                </div>
                <p className="text-foreground/40 max-w-xl text-lg">
                  {step.description}
                </p>
              </div>
            ))}
          </div>

          <div className="relative flex w-full justify-end">
            <div className="relative aspect-[3/2] h-fit w-full max-w-[834px] overflow-hidden rounded-lg drop-shadow-lg">
              <Image
                src="/backgrounds/how-it-works.png"
                alt="Competitor Analysis Agent"
                className="h-auto rounded-lg object-cover"
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
