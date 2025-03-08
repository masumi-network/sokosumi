import { Star } from "lucide-react";
import Image from "next/image";

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

  return (
    <Card className="flex h-full w-full max-w-sm flex-col overflow-hidden">
      <div className="relative h-48 w-full shrink-0">
        <Image
          src={image || "/placeholder.svg"}
          alt={`${title} image`}
          fill
          className="object-cover"
        />
      </div>

      <CardContent className="flex flex-1 flex-col p-6">
        <div
          className="mb-2 flex shrink-0"
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

        <h3 className="mb-2 shrink-0 text-xl font-bold">{title}</h3>
        <p className="mb-3 line-clamp-3 min-h-[4.5rem] overflow-hidden text-ellipsis whitespace-normal text-muted-foreground">
          {description}
        </p>
        <div className="flex min-h-[1.5rem] shrink-0 flex-nowrap overflow-hidden">
          {tags.length > 0 &&
            tags.slice(0, 3).map((tag, index) => (
              <Badge key={index} variant="secondary" className="mr-2 shrink-0">
                {tag}
              </Badge>
            ))}
        </div>
      </CardContent>

      <CardFooter className="mt-auto shrink-0 p-6">
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
