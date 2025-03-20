import { Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";

import BadgeCloud from "./badge-cloud";

interface AgentCardProps {
  id: string;
  name: string;
  description: string;
  averageStars: number | null;
  image: string;
  price: number;
  tags: string[];
}

export function AgentCardSkeleton() {
  return (
    <Card className="flex h-full w-full max-w-md min-w-96 flex-col overflow-hidden py-0">
      <div className="bg-muted relative h-48 w-full shrink-0 animate-pulse" />

      <CardContent className="flex flex-1 flex-col px-6 pb-3">
        <div className="mb-2 flex shrink-0 gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-muted h-5 w-5 animate-pulse rounded-full"
            />
          ))}
        </div>

        <div className="bg-muted mb-2 h-7 w-3/4 shrink-0 animate-pulse rounded" />
        <div className="bg-muted mb-3 h-16 w-full shrink-0 animate-pulse rounded" />
        <div className="flex min-h-[1.5rem] shrink-0 flex-nowrap gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-muted h-6 w-20 animate-pulse rounded-full"
            />
          ))}
        </div>
      </CardContent>

      <CardFooter className="mt-auto shrink-0 px-6 pt-2 pb-4">
        <div className="flex items-center gap-4">
          <div className="bg-muted h-10 w-24 animate-pulse rounded" />
          <div className="bg-muted h-4 w-24 animate-pulse rounded" />
        </div>
      </CardFooter>
    </Card>
  );
}

export default function AgentCard({
  id,
  name,
  description,
  averageStars,
  image,
  price,
  tags,
}: AgentCardProps) {
  const t = useTranslations("Components.AgentCard");
  return (
    <Card className="flex h-full w-full max-w-md min-w-96 flex-col overflow-hidden py-0">
      <div className="relative h-48 w-full shrink-0">
        <Image
          src={image || "/placeholder.svg"}
          alt={`${name} image`}
          fill
          className="object-cover"
        />
      </div>

      <CardContent className="flex flex-1 flex-col px-6 pb-3">
        {averageStars !== null && (
          <div
            className="mb-2 flex shrink-0"
            aria-label={`Rating: ${averageStars} out of 5 stars`}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`h-5 w-5 ${i < averageStars ? "fill-primary text-primary" : "text-muted-foreground"}`}
                aria-hidden="true"
              />
            ))}
          </div>
        )}

        <h3 className="mb-2 shrink-0 text-xl font-bold">{name}</h3>
        <p className="text-muted-foreground mb-3 line-clamp-3 min-h-[4.5rem] overflow-hidden text-ellipsis whitespace-normal">
          {description}
        </p>
        <div className="flex min-h-[1.5rem] shrink-0 flex-nowrap overflow-hidden">
          <BadgeCloud tags={tags} />
        </div>
      </CardContent>

      <CardFooter className="mt-auto shrink-0 px-6 pt-2 pb-4">
        <div className="flex items-center gap-4">
          <Link href={`/gallery/${id}`}>
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
