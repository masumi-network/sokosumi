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

interface BreadcrumbNavigationClientProps {
  agents: AgentDTO[];
  className?: string | undefined;
}

export default function BreadcrumbNavigationClient({
  agents,
  className,
}: BreadcrumbNavigationClientProps) {
  const pathname = usePathname();
  const t = useTranslations("Navigation");

  const pathnames = pathname.split("/").filter(Boolean);

  // Get the path without the last component
  const pathWithoutLast = "/" + pathnames.slice(0, -1).join("/");
  // Get the last path component
  const lastPathComponent = pathnames.pop();

  const agent = agents.find((a) => a.id === lastPathComponent);

  if (!agent) {
    return null;
  }

  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href={pathWithoutLast}>{t("gallery")}</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{agent.name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
