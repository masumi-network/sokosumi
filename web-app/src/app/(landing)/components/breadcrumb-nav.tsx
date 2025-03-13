"use client";

import { usePathname } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { dummyAgents } from "@/data/agents";

export default function BreadcrumbNav() {
  const pathname = usePathname();

  // Only show breadcrumb in gallery/[agent] pages
  if (!pathname.startsWith("/gallery/") || pathname === "/gallery") {
    return null;
  }

  const agentId = pathname.split("/").pop();
  const agent = dummyAgents.find((a) => a.id === agentId);

  if (!agent) {
    return null;
  }

  return (
    <div className="container mx-auto px-4">
      <div className="flex items-center gap-4 py-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/gallery">Gallery</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{agent.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </div>
  );
}
