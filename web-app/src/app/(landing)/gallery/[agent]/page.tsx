import { ChevronLeft } from "lucide-react";
import Image from "next/image";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";

interface AgentSummaryProps {
  name: string;
  description: string;
  imageUrl: string;
  price: number;
}

function AgentSummary({
  name,
  description,
  imageUrl,
  price,
}: AgentSummaryProps) {
  return (
    <div className="flex h-48 w-full overflow-hidden">
      <div className="relative h-full w-48">
        <Image
          src={imageUrl}
          alt={name}
          fill
          className="rounded-md object-cover"
        />
      </div>
      <div className="flex flex-1 flex-col justify-between p-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">{name}</h2>
          <p className="text-muted-foreground line-clamp-1">{description}</p>
        </div>
        <div className="flex items-end justify-between">
          <div className="flex items-end gap-3">
            <Button variant="default" size="lg">
              Hire
            </Button>
            <Button variant="outline" size="lg">
              Share
            </Button>
            <div>
              <p className="text-lg font-semibold">{price} credits</p>
              <p className="text-muted-foreground text-sm">amount may vary</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function Page({
  params,
}: {
  params: Promise<{ agent: string }>;
}) {
  const { agent } = await params;

  // This is temporary mock data - replace with actual data fetching
  const agentData = {
    name: "Competitor Analysis",
    description:
      "An advanced AI agent specialized in creative problem-solving and efficient task execution.",
    imageUrl: "/placeholder.svg", // Replace with actual image path
    price: 50,
  };

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
              <BreadcrumbPage>{agent}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="space-y-6">
        <AgentSummary {...agentData} />
      </div>
    </div>
  );
}
