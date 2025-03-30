import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { cn } from "@/lib/utils";
import { AppRoute } from "@/types/routes";

import { BadgeCloud } from "./badge-cloud";

interface AgentDetailSkeletonProps {
  className?: string;
}

function AgentDetailSkeleton({ className }: AgentDetailSkeletonProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {/* Agent Summary */}
      <div className="flex h-48 w-full overflow-hidden">
        <div className="relative h-full w-48">
          <Skeleton className="h-full w-full rounded-md" />
        </div>
        <div className="flex flex-1 flex-col px-6 py-2">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="mt-1 h-5 w-32" />
            <Skeleton className="mt-1 h-5 w-24" />
          </div>
          <div className="mt-auto flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
            </div>
          </div>
        </div>
      </div>

      {/* Badge Cloud */}
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((index) => (
          <Skeleton key={index} className="h-6 w-16 rounded-full" />
        ))}
      </div>

      {/* Description */}
      <div className="text-muted-foreground">
        <Skeleton className="h-4 w-full max-w-3xl" />
        <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
        <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
      </div>

      {/* Example Output */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[1, 2, 3].map((index) => (
          <Skeleton
            key={index}
            className="h-64 w-auto flex-shrink-0 rounded-lg"
          />
        ))}
      </div>

      {/* Legal Links */}
      <div className="text-muted-foreground flex flex-wrap gap-6 text-sm">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  );
}

interface AgentDetailsProps {
  agent: AgentDTO;
  className?: string;
}

function AgentDetails({ agent, className }: AgentDetailsProps) {
  const t = useTranslations("Components.Agents.AgentDetail");
  const {
    name,
    description,
    author,
    image,
    credits,
    tags,
    exampleOutput,
    legal,
  } = agent;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Agent Summary */}
      <div className="flex w-full flex-col gap-y-4 sm:flex-row">
        <div className="relative mx-auto h-48 w-48">
          <Image
            src={image}
            alt={name}
            fill
            className="rounded-md object-cover"
            priority
          />
        </div>
        <div className="flex flex-1 flex-col gap-y-2 p-2 sm:px-6">
          <div>
            <h2 className="text-2xl font-bold">{name}</h2>
            <p className="text-muted-foreground line-clamp-1">
              {t("byAuthor", { author })}
            </p>
            <p className="pt-1 text-sm font-medium">
              {t("pricing", { price: credits })}
            </p>
          </div>
          <div className="mt-auto flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Link href={`${AppRoute.Jobs}/${agent.id}`}>
                <Button variant="default" size="lg">
                  {t("hire")}
                </Button>
              </Link>
              <Button variant="outline" size="lg">
                {t("share")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Tags */}
      <BadgeCloud tags={tags} />
      <div className="text-muted-foreground">
        <p>{description}</p>
      </div>

      {/* Example Output */}
      <ScrollArea>
        <div className="flex gap-4 pb-4">
          {exampleOutput.map((_, index) => (
            <Image
              key={index}
              src="/placeholder.svg"
              alt={`Placeholder ${index + 1}`}
              className="h-64 w-64 flex-shrink-0 rounded-lg object-cover"
              width={256}
              height={256}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Developer Information */}
      <div className="text-muted-foreground flex gap-6 text-sm">
        {legal && <p>{t("Legal.fromDeveloper")}</p>}
        {legal?.privacyPolicy && (
          <Link
            href={legal.privacyPolicy}
            className="hover:text-foreground underline underline-offset-4 transition-colors"
          >
            {t("Legal.privacyPolicy")}
          </Link>
        )}
        {legal?.terms && (
          <Link
            href={legal.terms}
            className="hover:text-foreground underline underline-offset-4 transition-colors"
          >
            {t("Legal.terms")}
          </Link>
        )}
        {legal?.other && (
          <Link
            href={legal.other}
            className="hover:text-foreground underline underline-offset-4 transition-colors"
          >
            {t("Legal.other")}
          </Link>
        )}
      </div>
    </div>
  );
}

export { AgentDetails, AgentDetailSkeleton };
