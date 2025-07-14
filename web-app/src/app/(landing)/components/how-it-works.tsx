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
    <div className="flex flex-col gap-8 md:gap-12">
      <h2 className="text-2xl font-light tracking-tight md:text-5xl">
        {t("title")}
      </h2>

      <div className="flex w-full flex-col-reverse gap-4 md:gap-6 lg:flex-row">
        <div className="max-w-full space-y-8 lg:max-w-[327px] lg:py-20 lg:pt-10">
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

        <div className="flex w-full justify-end">
          <div className="relative aspect-[3/2] h-fit w-full max-w-[834px] overflow-hidden rounded-lg drop-shadow-lg">
            <Image
              src="/backgrounds/how-it-works.jpg"
              alt="Competitor Analysis Agent"
              className="h-auto rounded-lg object-cover"
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
