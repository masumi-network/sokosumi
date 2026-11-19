import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { readAdminSeoAlerts } from "@/lib/services/admin-seo-alerts.service";

export async function SeoAlertSummary() {
  const t = await getTranslations("App.Admin.SeoAlerts");
  try {
    const { critical, warning, reconnect } = await readAdminSeoAlerts({
      period: "30",
      page: 1,
      view: "counts",
    });
    return (
      <div className="flex flex-wrap gap-2">
        <Badge variant={critical ? "destructive" : "secondary"}>
          {t("summary", { critical, warning })}
        </Badge>
        {reconnect > 0 && (
          <Badge variant="outline">
            {t("connectionSummary", { count: reconnect })}
          </Badge>
        )}
      </div>
    );
  } catch (error) {
    unstable_rethrow(error);
    return (
      <span className="text-muted-foreground text-sm">{t("unavailable")}</span>
    );
  }
}
