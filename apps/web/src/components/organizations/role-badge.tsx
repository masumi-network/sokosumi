import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { MemberRole } from "@/lib/clients/generated/core";
import { InvitationDisplayStatus } from "@/lib/constants/invitation-display-status";

export function OrganizationRoleBadge({ role }: { role: string | null }) {
  const t = useTranslations("Components.Organizations.Role");

  if (role === MemberRole.OWNER) {
    return <Badge variant="default">{t("owner")}</Badge>;
  }

  if (role === MemberRole.ADMIN) {
    return <Badge variant="secondary">{t("admin")}</Badge>;
  }

  if (role === MemberRole.MEMBER) {
    return <Badge variant="outline">{t("member")}</Badge>;
  }

  if (role === InvitationDisplayStatus.PENDING) {
    return <Badge variant="outline">{t("pending")}</Badge>;
  }

  if (role === InvitationDisplayStatus.EXPIRED) {
    return <Badge variant="destructive">{t("expired")}</Badge>;
  }

  return null;
}
