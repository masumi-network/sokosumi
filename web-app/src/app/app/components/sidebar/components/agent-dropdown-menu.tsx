import { Archive, Ellipsis, Share, Trash } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Agent } from "@/prisma/generated/client";

interface AgentDropdownMenuProps {
  agent: Agent;
}

export default function AgentDropdownMenu({}: AgentDropdownMenuProps) {
  const t = useTranslations("App.Sidebar.Content.AgentDropdownMenu");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Ellipsis className="h-4 w-4 opacity-0 group-hover/agent-menu:opacity-100" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <div className="text-muted-foreground flex items-center gap-2">
              <Share />
              <span>{t("share")}</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <div className="text-muted-foreground flex items-center gap-2">
              <Archive />
              <span>{t("archive")}</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <div className="flex items-center gap-2">
            <Trash className="text-destructive" />
            <span className="text-destructive">{t("delete")}</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
