import { Loader, LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import IconTitleDescription from "@/components/icon-title-description";

import HorizontalScroll from "./components/horizontal-scroll";

interface NumberTalk {
  title: string;
  icon: string;
  description: string;
}

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
  const t = useTranslations("Landing.Sections.NumberTalks");
  return (
    <>
      <HorizontalScroll>
        {(t.raw("numbers") as NumberTalk[]).map((number) => (
          <IconTitleDescription
            key={number.title}
            icon={getIconByName(number.icon)}
            title={number.title}
            description={number.description}
          />
        ))}
      </HorizontalScroll>
    </>
  );
}
