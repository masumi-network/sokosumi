import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

import TopNotice, { TOP_NOTICE_ACTION_CLASS_NAME } from "./top-notice";

interface LowCreditsNoticeProps {
  kind: "lowCredits" | "outOfCredits";
  path: string;
}

export default async function LowCreditsNotice({
  kind,
  path,
}: LowCreditsNoticeProps) {
  const t = await getTranslations("App.LowCreditsNotice");

  return (
    <TopNotice
      title={t(
        `${kind === "outOfCredits" ? "outOfCredits" : "almostOut"}.title`,
      )}
      description={t(
        `${kind === "outOfCredits" ? "outOfCredits" : "almostOut"}.description`,
      )}
      action={
        <Button
          asChild
          variant="outline"
          size="sm"
          className={TOP_NOTICE_ACTION_CLASS_NAME}
        >
          <Link href={path}>
            <span>{t("button")}</span>
            <ArrowUpRight aria-hidden />
          </Link>
        </Button>
      }
    />
  );
}
