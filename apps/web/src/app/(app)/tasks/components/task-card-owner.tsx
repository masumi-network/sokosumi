"use client";

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { User } from "lucide-react";
import { useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { TaskWithCoworker } from "@/lib/types/task";

interface TaskCardOwnerProps {
  user: TaskWithCoworker["user"];
}

export function TaskCardOwner({ user }: TaskCardOwnerProps) {
  const t = useTranslations("App.Tasks.Detail");
  const image = user.image ? resolveIpfsOrHttpUrl(user.image) : null;
  const label = `${t("owner")}: ${user.name}`;

  return (
    <div className="flex justify-end">
      <div
        className="text-muted-foreground flex max-w-full items-center gap-1.5 text-xs"
        aria-label={label}
        title={label}
      >
        <span className="max-w-[140px] truncate">{user.name}</span>
        <Avatar className="bg-background size-5 shrink-0 ring-2 ring-background">
          {image ? (
            <AvatarImage
              src={image}
              alt={user.name}
              className="object-cover"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <AvatarFallback className="bg-muted text-[10px] font-medium">
            {user.name.slice(0, 1).toUpperCase() || (
              <User className="size-3" aria-hidden />
            )}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}
