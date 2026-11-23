import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MyWeekSwitch } from "./my-week-switch";

/** The account page's stand-up card: one switch for the person's own week. */
export function MyWeekCard({ included }: { included: boolean }) {
  const t = useTranslations("App.TeamStandup.MyWeek");
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("cardTitle")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <MyWeekSwitch included={included} />
      </CardContent>
    </Card>
  );
}
