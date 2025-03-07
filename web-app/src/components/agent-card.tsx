"use client";

import { Star } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Agent } from "@/data/agents";

export default function AgentCard({ agent }: { agent: Agent }) {
  const {
    title,
    description,
    rating,
    image,
    buttonText,
    pricingTitle,
    pricingCaption,
    tags,
  } = agent;
  const normalizedRating = Math.max(0, Math.min(5, Math.floor(rating)));
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleTags, setVisibleTags] = useState<string[]>([]);

  useEffect(() => {
    if (!containerRef.current || tags.length === 0) return;

    const container = containerRef.current;
    const containerWidth = container.offsetWidth;
    let currentWidth = 0;
    const visibleTagsList: string[] = [];

    for (const tag of tags) {
      const tempBadge = document.createElement("div");
      tempBadge.className =
        "inline-block px-2 py-1 text-xs font-medium rounded-full bg-secondary text-secondary-foreground mr-2";
      tempBadge.textContent = tag;
      document.body.appendChild(tempBadge);

      const badgeWidth = tempBadge.offsetWidth;
      document.body.removeChild(tempBadge);

      if (currentWidth + badgeWidth <= containerWidth) {
        currentWidth += badgeWidth;
        visibleTagsList.push(tag);
      } else {
        break;
      }
    }

    setVisibleTags(visibleTagsList);
  }, [tags]);

  return (
    <Card className="flex h-full w-full max-w-sm flex-col overflow-hidden">
      <div className="relative h-48 w-full">
        <Image
          src={image || "/placeholder.svg"}
          alt={`${title} profile image`}
          fill
          className="object-cover"
        />
      </div>

      <CardContent className="flex-1 p-6">
        <div
          className="mb-2 flex"
          aria-label={`Rating: ${normalizedRating} out of 5 stars`}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={`h-5 w-5 ${i < normalizedRating ? "fill-primary text-primary" : "text-muted-foreground"}`}
              aria-hidden="true"
            />
          ))}
        </div>

        <h3 className="mb-2 text-xl font-bold">{title}</h3>
        {tags.length > 0 && (
          <div
            ref={containerRef}
            className="mb-3 flex flex-nowrap overflow-hidden"
          >
            {visibleTags.map((tag, index) => (
              <Badge key={index} variant="secondary" className="mr-2 shrink-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <p className="line-clamp-3 min-h-[4.5rem] overflow-hidden text-ellipsis whitespace-normal text-muted-foreground">
          {description}
        </p>
      </CardContent>

      <CardFooter className="mt-auto p-6">
        <div className="flex items-center gap-4">
          <Button>{buttonText}</Button>

          <div>
            <h4 className="font-medium">{pricingTitle}</h4>
            <p className="text-xs text-muted-foreground">{pricingCaption}</p>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}
