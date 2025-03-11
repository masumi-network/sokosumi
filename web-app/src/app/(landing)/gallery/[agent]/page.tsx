import { Building2, ChevronLeft, Timer } from "lucide-react";

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
import Box from "./components/box";

export default async function Page({
  params,
}: {
  params: Promise<{ agent: string }>;
}) {
  const { agent } = await params;

  const dummyAgent = dummyAgents.find((a) => a.id === agent)!;

  // This is temporary mock data - replace with actual data fetching
  // const agentData = {
  //   name: "Competitor Analysis",
  //   description:
  //     "An advanced AI agent specialized in creative problem-solving and efficient task execution.",
  //   imageUrl: "/placeholder.svg", // Replace with actual image path
  //   price: 50,
  // };

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
        <div className="flex flex-row gap-3">
          <Box icon={Building2} text={dummyAgent.author} />
          <Box icon={Timer} text="30-45 minutes" />
        </div>
      </div>
    </div>
  );
}
