import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

import TopNotice, {
  getTopNoticeActionClassName,
  type TopNoticeTone,
} from "./top-notice";

interface LowCreditsNoticeProps {
  kind: "lowCredits" | "outOfCredits";
  path: string;
}

export default async function LowCreditsNotice({
  kind,
  path,
}: LowCreditsNoticeProps) {
  const t = await getTranslations("App.LowCreditsNotice");
  const tone: TopNoticeTone =
    kind === "outOfCredits" ? "destructive" : "warning";
  const routeKey = path.includes("tab=subscription")
    ? "subscription"
    : "credits";
  const stateKey = kind === "outOfCredits" ? "outOfCredits" : "almostOut";

  return (
    <TopNotice
      tone={tone}
      title={t(`${routeKey}.${stateKey}.title`)}
      description={t(`${routeKey}.${stateKey}.description`)}
      action={
        <Button
          asChild
          variant="outline"
          size="sm"
          className={getTopNoticeActionClassName(tone)}
        >
          <Link href={path}>
            <span>{t(`${routeKey}.button`)}</span>
            <ArrowUpRight aria-hidden />
          </Link>
        </Button>
      }
    />
  );
}
