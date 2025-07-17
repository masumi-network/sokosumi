import { MoveUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export default function FreeCreditsBanner() {
  const t = useTranslations("Landing.Header.FreeCreditsBanner");

  return (
    <Link href="/register" className="z-100">
      <div className="bg-foreground text-background flex items-center justify-center gap-1 p-2">
        <h2 className="text-center text-sm">
          {t("start")}
          <span className="text-primary">{t("main")}</span>
          {t("end")}
        </h2>
        <MoveUpRight className="hidden h-4 w-4 md:block" />
      </div>
    </Link>
  );
}
