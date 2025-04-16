import { Clock, DollarSign, Timer } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function NumberTalks() {
  const t = await getTranslations("Landing.Page.NumberTalks");
  return (
    <div className="mx-auto w-full">
      <h2 className="mb-16 text-5xl font-light">{t("title")}</h2>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-16">
        {/* Running Time */}
        <div className="border-quinary space-y-4 border-t pt-8">
          <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium tracking-wider uppercase">
            <Clock className="h-4 w-4" />
            <span>{t("Numbers.Duration.title").toUpperCase()}</span>
          </div>
          <div>
            <h3 className="mb-10 text-2xl">
              {t("Numbers.Duration.description")}
            </h3>
            <div className="flex items-start gap-2">
              <span className="text-7xl font-light">
                {t("Numbers.Duration.number")}
              </span>
              <span className="text-muted-foreground pt-2">
                {t("Numbers.Duration.caption")}
              </span>
            </div>
          </div>
        </div>

        {/* Less Costs */}
        <div className="border-quinary space-y-4 border-t pt-8">
          <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium tracking-wider uppercase">
            <DollarSign className="h-4 w-4" />
            <span>{t("Numbers.Cost.title").toUpperCase()}</span>
          </div>
          <div>
            <h3 className="mb-10 text-2xl">{t("Numbers.Cost.description")}</h3>
            <div className="flex items-start gap-2">
              <span className="text-7xl font-light">
                {t("Numbers.Cost.number")}
              </span>
              <span className="text-muted-foreground pt-2">
                {t("Numbers.Cost.caption")}
              </span>
            </div>
          </div>
        </div>

        {/* Time Savings */}
        <div className="border-quinary space-y-4 border-t pt-8">
          <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium tracking-wider uppercase">
            <Timer className="h-4 w-4" />
            <span>{t("Numbers.Savings.title").toUpperCase()}</span>
          </div>
          <div>
            <h3 className="mb-10 text-2xl">
              {t("Numbers.Savings.description")}
            </h3>
            <div className="flex items-start gap-2">
              <span className="text-7xl font-light">
                {t("Numbers.Savings.number")}
              </span>
              <span className="text-muted-foreground pt-2">
                {t("Numbers.Savings.caption")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
