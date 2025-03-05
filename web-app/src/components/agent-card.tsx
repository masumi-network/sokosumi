import { Star } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";

interface AgentCardProps {
  image: string;
  rating: number;
  title: string;
  description: string;
  buttonText: string;
  pricingTitle: string;
  pricingCaption: string;
}

export default function AgentCard({
  image = "/placeholder.svg?height=200&width=400",
  rating = 4,
  title = "Agent Smith",
  description = "Professional real estate agent with over 10 years of experience in the market.",
  buttonText = "Run Analysis",
  pricingTitle = "Free Trial",
  pricingCaption = "Normal Price: 10-30 credits/run",
}: AgentCardProps) {
  const normalizedRating = Math.max(0, Math.min(5, Math.floor(rating)));

  return (
    <Card className="w-full max-w-sm overflow-hidden">
      <div className="relative h-48 w-full">
        <Image
          src={image || "/placeholder.svg"}
          alt={`${title} profile image`}
          fill
          className="object-cover"
        />
      </div>

      <CardContent className="p-6">
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
        <p className="mb-4 line-clamp-5 overflow-hidden text-ellipsis text-muted-foreground">
          {description}
        </p>
      </CardContent>

      <CardFooter className="flex items-center p-6 pt-0">
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
