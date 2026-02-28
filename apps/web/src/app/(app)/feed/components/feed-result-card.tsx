"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { AgentIcon } from "@/components/agents/agent-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FeedItem } from "@/lib/services/feed.service";
import { formatTimeAgo } from "@/lib/utils/datetime";
import { getInitials } from "@/lib/utils/text";

interface FeedResultCardProps {
  item: FeedItem;
}

function resolveTitle(
  item: FeedItem,
  untitledJob: string,
  untitledTask: string,
) {
  const trimmedTitle = item.title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  if (item.type === "job") {
    return untitledJob;
  }

  return untitledTask;
}

export function FeedResultCard({ item }: FeedResultCardProps) {
  const t = useTranslations("App.Feed");
  const actorName =
    item.actor.name?.trim() ||
    (item.actor.kind === "agent"
      ? t("unknownAgent")
      : t("unknownCoworker"));
  const title =
    item.displayTitle ||
    resolveTitle(item, t("untitledJob"), t("untitledTask"));

  return (
    <Link href={`/feed/${item.id}`} className="block">
      <Card className="hover:bg-muted/30 gap-3 py-4 transition-colors">
        <CardHeader className="px-4">
          <div className="flex min-w-0 items-center gap-2">
            {item.actor.kind === "agent" ? (
              <AgentIcon
                agent={{
                  name: actorName,
                  icon: item.actor.icon,
                }}
              />
            ) : (
              <Avatar className="size-5">
                {item.actor.image ? (
                  <AvatarImage
                    src={item.actor.image}
                    alt={actorName}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="text-[10px]">
                  {getInitials(actorName)}
                </AvatarFallback>
              </Avatar>
            )}
            <div className="min-w-0">
              <p className="text-foreground truncate text-sm font-medium">
                {actorName}
              </p>
              <p className="text-muted-foreground text-xs">
                {formatTimeAgo(item.activityAt)}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 px-4">
          <div className="pt-1">
            <Badge variant="outline">
              {item.type === "job" ? t("type.job") : t("type.task")}
            </Badge>
          </div>
          <CardTitle className="line-clamp-1 text-base">{title}</CardTitle>
          <p className="text-muted-foreground line-clamp-5 text-sm">
            {item.previewText?.trim() || t("fallbackPreview")}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
