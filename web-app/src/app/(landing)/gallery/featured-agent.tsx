"use client";

import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Agent } from "@/data/agents";

interface FeaturedAgentProps {
  sectionTitle: string;
  agent: Agent;
  buttonText: string;
  onButtonClick?: () => void;
}

export function FeaturedAgent({
  sectionTitle,
  agent,
  buttonText,
  onButtonClick,
}: FeaturedAgentProps) {
  return (
    <div className="flex flex-col items-center gap-8 md:flex-row">
      {/* Text Content Section - 1/3 width */}
      <div className="w-full space-y-6 md:w-1/3">
        <h2 className="text-2xl font-bold">{sectionTitle}</h2>
        <div className="space-y-4">
          <h3 className="text-4xl font-bold tracking-tight">{agent.title}</h3>
        </div>
        <p className="text-muted-foreground text-lg">{agent.description}</p>
        {agent.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {agent.tags.map((tag, index) => (
              <Badge key={index} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <Button size="lg" onClick={onButtonClick} className="w-full md:w-auto">
          {buttonText}
        </Button>
      </div>

      {/* Image Section - 2/3 width */}
      <div className="relative aspect-16/9 w-full md:w-2/3">
        <Image
          src={agent.image}
          alt={`${agent.title} image`}
          fill
          className="rounded-lg object-cover"
          priority
        />
      </div>
    </div>
  );
}
