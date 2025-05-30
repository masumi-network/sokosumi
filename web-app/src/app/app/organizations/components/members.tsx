import { Building2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MemberWithOrganization } from "@/lib/db";
import { Role } from "@/prisma/generated/client";

import MemberActionButtons from "./member-action-buttons";

interface MembersProps {
  members: MemberWithOrganization[];
}

export default function Members({ members }: MembersProps) {
  return (
    <div className="flex w-full flex-col divide-y rounded-lg border">
      {members.map((member) => (
        <MemberRow key={member.id} member={member} />
      ))}
    </div>
  );
}

export function MembersSkeleton() {
  return (
    <div className="flex w-full flex-col divide-y rounded-lg border">
      {[1, 2, 3].map((_, index) => (
        <div key={index} className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <Building2 size={24} />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MemberRow({ member }: { member: MemberWithOrganization }) {
  const { organization, role } = member;
  const { id: organizationId, name, logo } = organization;

  return (
    <div className="flex items-center justify-between p-4">
      <div className="flex items-center gap-4">
        {logo ? (
          <Image src={logo} alt={name} width={24} height={24} />
        ) : (
          <Building2 size={24} />
        )}
        <Link href={`/app/organizations/${organizationId}`}>
          <p className="text-primary text-lg font-medium hover:underline">
            {name}
          </p>
        </Link>
        <RoleBadge role={role} />
      </div>
      <MemberActionButtons organization={organization} />
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const t = useTranslations("App.Organizations.Role");

  if (role === Role.ADMIN) {
    return <Badge variant="secondary">{t("admin")}</Badge>;
  }
  return <Badge variant="outline">{t("member")}</Badge>;
}
