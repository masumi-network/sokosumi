import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";

interface DeveloperCoworkersListProps {
  coworkers: Coworker[];
}

function getCoworkerImageUrl(coworker: Coworker): string | undefined {
  if (!coworker.image) {
    return undefined;
  }
  return resolveIpfsOrHttpUrl(coworker.image);
}

export async function DeveloperCoworkersList({
  coworkers,
}: DeveloperCoworkersListProps) {
  const t = await getTranslations("App.Developer.Coworkers");

  if (coworkers.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("List.empty")}</p>;
  }

  return (
    <ul className="divide-border divide-y rounded-lg border">
      {coworkers.map((coworker) => {
        const imageUrl = getCoworkerImageUrl(coworker);

        return (
          <li
            key={coworker.id}
            className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <Avatar className="size-10 shrink-0">
                {imageUrl ? (
                  <AvatarImage src={imageUrl} alt={coworker.name} />
                ) : null}
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                  {coworker.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 space-y-1">
                <p className="truncate font-medium">{coworker.name}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {coworker.caption?.trim() || t("List.noCaption")}
                </p>
                <p className="text-muted-foreground font-mono text-xs">
                  {coworker.slug}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild className="shrink-0">
              <Link href={`/developer/coworkers/${coworker.id}`}>
                {t("List.edit")}
              </Link>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
