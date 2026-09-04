import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NOTIFICATION_PREFERENCES_HREF } from "../constants";

/**
 * The account page's pointer at the notification settings.
 *
 * The matrix itself lives on its own route. Here the section keeps its place
 * and its two lines, so a reader scanning the page still finds Notifications
 * where it was, and one press takes them to it.
 */
export function NotificationSettingsLink() {
  const t = useTranslations("App.Account.Notifications");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link href={NOTIFICATION_PREFERENCES_HREF}>
              {t("manageLink")}
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
