import { FolderClock, Pin } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const pinnedAgents = Array.from(
  { length: 10 },
  (_, index) => `Random Agent #${index + 1}`,
);
const recentlyUsedAgents = Array.from(
  { length: 10 },
  (_, index) => `Random Agent #${index + 1}`,
);

interface LeftPanelContentProps {
  className?: string;
}

export function LeftPanelContent({ className = "" }: LeftPanelContentProps) {
  return (
    <ScrollArea className={cn("h-full w-full bg-muted p-4", className)}>
      <div className="mt-4 flex items-center gap-2 text-sm font-bold text-muted-foreground">
        You Pinned Agents
        <Pin />
      </div>
      <div className="mt-4">
        {pinnedAgents.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {pinnedAgents.map((agent) => (
              <li key={agent} className="text-sm font-medium text-foreground">
                {agent}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-gray-400">no pinned agents</div>
        )}
      </div>

      <div className="mt-12 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        Recently Used Agents
        <FolderClock />
      </div>
      <div className="mt-4">
        {recentlyUsedAgents.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {recentlyUsedAgents.map((agent, index) => (
              <li key={index} className="text-sm font-medium text-foreground">
                {agent}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-gray-400">no recently used agents</div>
        )}
      </div>
    </ScrollArea>
  );
}

export default function MainLeftPanel() {
  return (
    <div className="hidden h-full w-64 md:block">
      <LeftPanelContent />
    </div>
  );
}
