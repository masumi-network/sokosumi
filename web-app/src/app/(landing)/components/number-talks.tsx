import { Clock, DollarSign, Timer } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

interface NumberTalkSectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  number: string;
  caption: string;
}

export function NumberTalkSection({
  icon,
  title,
  description,
  number,
  caption,
}: NumberTalkSectionProps) {
  return (
    <div className="border-quinary space-y-4 border-t pt-8">
      <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium tracking-wider uppercase">
        {icon}
        <span>{title}</span>
      </div>
      <div>
        <h3 className="mb-10 text-2xl">{description}</h3>
        <div className="flex items-start gap-2">
          <span className="text-7xl font-light">{number}</span>
          <span className="text-muted-foreground pt-2">{caption}</span>
        </div>
      </div>
    </div>
  );
}

export default async function NumberTalks() {
  const t = await getTranslations("Landing.Page.NumberTalks");
  return (
    <div className="mx-auto w-full">
      <h2 className="mb-16 text-5xl font-light">{t("title")}</h2>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-16">
        <NumberTalkSection
          icon={<Clock className="h-4 w-4" />}
          title={t("Numbers.Duration.title")}
          description={t("Numbers.Duration.description")}
          number={t("Numbers.Duration.number")}
          caption={t("Numbers.Duration.caption")}
        />
        <NumberTalkSection
          icon={<DollarSign className="h-4 w-4" />}
          title={t("Numbers.Cost.title")}
          description={t("Numbers.Cost.description")}
          number={t("Numbers.Cost.number")}
          caption={t("Numbers.Cost.caption")}
        />
        <NumberTalkSection
          icon={<Timer className="h-4 w-4" />}
          title={t("Numbers.Savings.title")}
          description={t("Numbers.Savings.description")}
          number={t("Numbers.Savings.number")}
          caption={t("Numbers.Savings.caption")}
        />
      </div>
    </div>
  );
}
