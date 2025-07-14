import Link from "next/link";
import { useTranslations } from "next-intl";

import { SokosumiIcon } from "@/components/masumi-icons";

export default function GalleryButton() {
  const t = useTranslations("App.Sidebar.Footer.AgentButton");

  return (
    <Link href="/app/agents">
      <div className="flex flex-col">
        <div className="border-border mb-2 w-full border-t" />
        <div className="flex items-center gap-2 p-4">
          <SokosumiIcon width={32} height={32} />
          <div className="flex flex-1 flex-col">
            <h3 className="text-muted-foreground text-base font-bold">
              {t("title")}
            </h3>
          </div>
        </div>
      </div>
    </Link>
  );
}
