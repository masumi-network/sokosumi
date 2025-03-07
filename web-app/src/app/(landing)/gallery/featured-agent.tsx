"use client";

import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface FeaturedAgentProps {
  sectionTitle: string;
  agentTitle: string;
  description: string;
  imageUrl: string;
  imageAlt: string;
  buttonText: string;
  onButtonClick?: () => void;
  tags?: string[];
}

export function FeaturedAgent({
  sectionTitle,
  agentTitle,
  description,
  imageUrl,
  imageAlt,
  buttonText,
  onButtonClick,
  tags = [],
}: FeaturedAgentProps) {
  return (
    <div className="flex flex-col items-center gap-8 md:flex-row">
      {/* Text Content Section - 1/3 width */}
      <div className="w-full space-y-6 md:w-1/3">
        <h2 className="text-2xl font-bold">{sectionTitle}</h2>
        <div className="space-y-4">
          <h3 className="text-4xl font-bold tracking-tight">{agentTitle}</h3>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag, index) => (
                <Badge key={index} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <p className="text-lg text-muted-foreground">{description}</p>
        <Button size="lg" onClick={onButtonClick} className="w-full md:w-auto">
          {buttonText}
        </Button>
      </div>

      {/* Image Section - 2/3 width */}
      <div className="relative aspect-[16/9] w-full md:w-2/3">
        <Image
          src={imageUrl}
          alt={imageAlt}
          fill
          className="rounded-lg object-cover"
          priority
        />
      </div>
    </div>
  );
}
