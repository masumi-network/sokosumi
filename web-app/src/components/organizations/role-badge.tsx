import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Role } from "@/prisma/generated/client";

export function OrganizationRoleBadge({ role }: { role: Role }) {
  const t = useTranslations("Components.Organization.Role");

  if (role === Role.ADMIN) {
    return <Badge variant="secondary">{t("admin")}</Badge>;
  }
  return <Badge variant="outline">{t("member")}</Badge>;
}
