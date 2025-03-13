import { Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";

import BadgeCloud from "./badge-cloud";

interface AgentCardProps {
  id: string;
  title: string;
  description: string;
  rating: number;
  image: string;
  price: number;
  tags: string[];
}

export default function AgentCard({ agent }: { agent: AgentCardProps }) {
  const { title, description, rating, image, price, tags } = agent;
  const normalizedRating = Math.max(0, Math.min(5, Math.floor(rating)));

  const t = useTranslations("Components.AgentCard");

  return (
    <Card className="flex h-full w-full max-w-md min-w-96 flex-col overflow-hidden py-0">
      <div className="relative h-48 w-full shrink-0">
        <Image
          src={image || "/placeholder.svg"}
          alt={`${title} image`}
          fill
          className="object-cover"
        />
      </div>

      <CardContent className="flex flex-1 flex-col px-6 pt-4 pb-3">
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
        <p className="text-muted-foreground mb-3 line-clamp-3 min-h-[4.5rem] overflow-hidden text-ellipsis whitespace-normal">
          {description}
        </p>
        <div className="flex min-h-[1.5rem] shrink-0 flex-nowrap overflow-hidden">
          <BadgeCloud tags={tags} />
        </div>
      </CardContent>

      <CardFooter className="mt-auto shrink-0 px-6 pt-2 pb-4">
        <div className="flex items-center gap-4">
          <Link href={`/gallery/${agent.id}`}>
            <Button>{t("button")}</Button>
          </Link>

          <div>
            <p className="text-muted-foreground text-s">
              {t("pricing", { price })}
            </p>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}
