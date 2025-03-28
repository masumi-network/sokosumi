import { Loader, LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import HorizontalScroll from "@/app/(landing)/components/horizontal-scroll";
import IconTitleDescription from "@/components/icon-title-description";

// Map icon names to actual Lucide components
const getIconByName = (name: string): LucideIcon => {
  const iconMap: Record<string, LucideIcon> = {
    Loader,
    TrendingDown,
    TrendingUp,
  };

  return iconMap[name] || Loader; // Fallback to Loader if icon not found
};

export default function NumberTalks() {
  const t = useTranslations("Landing.Page.NumberTalks.Numbers");
  const keys = ["Duration", "Cost", "Time"] as const;
  return (
    <>
      <HorizontalScroll>
        {keys.map((key) => (
          <IconTitleDescription
            key={key}
            icon={getIconByName(t(`${key}.icon`))}
            title={t(`${key}.title`)}
            description={t(`${key}.description`)}
          />
        ))}
      </HorizontalScroll>
    </>
  );
}
