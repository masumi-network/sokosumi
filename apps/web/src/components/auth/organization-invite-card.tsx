import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { Building2 } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface OrganizationInvitePreview {
  name: string;
  logo?: string | null;
}

interface OrganizationInviteCardProps {
  organization: OrganizationInvitePreview;
  title: string;
  description: ReactNode;
  children: ReactNode;
}

export function OrganizationInviteCard({
  organization,
  title,
  description,
  children,
}: OrganizationInviteCardProps) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="flex flex-col items-center text-center">
        <div className="bg-muted mb-2 flex size-16 items-center justify-center overflow-hidden rounded-2xl">
          {organization.logo ? (
            <Image
              src={resolveIpfsOrHttpUrl(organization.logo)}
              alt={organization.name}
              width={64}
              height={64}
              className="size-full object-cover"
            />
          ) : (
            <Building2 className="text-muted-foreground size-7" />
          )}
        </div>
        <CardTitle className="text-xl">{title}</CardTitle>
        <div className="text-muted-foreground space-y-1 text-sm">
          {description}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
