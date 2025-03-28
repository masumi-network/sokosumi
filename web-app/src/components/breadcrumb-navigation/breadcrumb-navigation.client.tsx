"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";

const parsePathname = (
  pathname: string,
): [agentId: string, galleryPath: string] | undefined => {
  const match = pathname.match(/^\/(dashboard\/)?gallery\/([^\/]+)$/);
  if (!match) {
    return;
  }
  return [
    match[2],
    match[1] === "dashboard/" ? "/dashboard/gallery" : "/gallery",
  ];
};

interface BreadcrumbNavigationClientProps {
  agents: AgentDTO[];
}

export default function BreadcrumbNavigationClient({
  agents,
}: BreadcrumbNavigationClientProps) {
  const pathname = usePathname();
  const t = useTranslations("Navigation");

  const parsed = parsePathname(pathname);

  if (!parsed) {
    return null;
  }

  const [agentId, galleryPath] = parsed;
  const agent = agents.find((a) => a.id === agentId);

  if (!agent) {
    return null;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href={galleryPath}>{t("gallery")}</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{agent.name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
