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

        <div className="relative flex w-full gap-6">
          <div className="w-full max-w-[327px] space-y-8 py-20 pt-40">
            {steps.map((step, index) => (
              <div
                key={step.number}
                className="space-y-3"
                style={{ opacity: `${1 / (index + 1 / (steps.length - 1))}` }}
              >
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
            <div className="relative aspect-[3/2] h-fit overflow-hidden rounded-lg drop-shadow-lg">
              <Image
                src="/backgrounds/how-it-works.png"
                alt="Competitor Analysis Agent"
                className="h-fit rounded-lg object-cover"
                width={834}
                height={556}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
