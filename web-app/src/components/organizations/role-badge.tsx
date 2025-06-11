import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { MemberRole } from "@/lib/db";

export function OrganizationRoleBadge({ role }: { role: string | null }) {
  const t = useTranslations("Components.Organizations.Role");

  if (role === MemberRole.ADMIN) {
    return <Badge variant="secondary">{t("admin")}</Badge>;
  }

  if (role === MemberRole.MEMBER) {
    return <Badge variant="outline">{t("member")}</Badge>;
  }

  return null;
}
