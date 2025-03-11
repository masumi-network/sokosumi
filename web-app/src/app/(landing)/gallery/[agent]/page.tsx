import { ChevronLeft } from "lucide-react";

import BadgeCloud from "@/components/badge-cloud";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { dummyAgents } from "@/data/agents";

import AgentSummary from "./components/agent-summary";

export default async function Page({
  params,
}: {
  params: Promise<{ agent: string }>;
}) {
  const { agent } = await params;

  const dummyAgent = dummyAgents.find((a) => a.id === agent)!;

  return (
    <div className="container mx-auto">
      <div className="flex items-center gap-4 py-4">
        <Button size="icon" className="h-8 w-8" asChild>
          <BreadcrumbLink href="/gallery">
            <ChevronLeft className="h-4 w-4" />
          </BreadcrumbLink>
        </Button>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/gallery">Gallery</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{dummyAgent.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="space-y-4">
        <AgentSummary {...dummyAgent} />
        <BadgeCloud tags={dummyAgent.tags} />
        <div className="text-muted-foreground">
          <p>{dummyAgent.description}</p>
        </div>
      </div>
    </div>
  );
}
