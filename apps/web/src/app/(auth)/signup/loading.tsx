import Link from "next/link";
import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";

export default function RegisterLoadingPage() {
  const t = useTranslations("Auth.Pages.SignUp");

  return (
    <div className="flex flex-1 flex-col">
      <div className="p-6">
        <h1 className="text-2xl font-light">{t("Header.title")}</h1>
        <p className="text-sm text-gray-400">{t("Header.description")}</p>
      </div>
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
        <div className="flex flex-col gap-4">
          {[1, 2, 3, 4].map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex flex-col items-center gap-2 sm:flex-row">
          <span className="text-muted-foreground text-sm">
            {t("Form.Login.message")}
          </span>
          <Link
            href="/login"
            className="text-primary text-sm font-medium hover:underline"
          >
            {t("Form.Login.link")}
          </Link>
        </div>
      </div>
    </div>
  );
}
