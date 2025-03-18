import Link from "next/link";
import { useTranslations } from "next-intl";

import { SokosumiIcon } from "@/components/masumi-icons";

export default function GalleryButton() {
  const t = useTranslations("App.Sidebar.Footer.AgentAddButton");

  return (
    <Link href="/dashboard/gallery">
      <div className="flex items-center gap-2 p-2">
        <SokosumiIcon width={32} height={32} />
        <div className="flex flex-1 flex-col">
          <h2 className="text-muted-foreground text-base font-bold">
            {t("title")}
          </h2>
          <p className="text-muted-foreground text-xs">{t("subtitle")}</p>
        </div>
      </div>
    </Link>
  );
}
