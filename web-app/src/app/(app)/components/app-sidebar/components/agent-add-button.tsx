import { Plus } from "lucide-react";

import { SokosumiIcon } from "@/components/masumi-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgentAddButtonProps {
  className?: string;
}

export default function AgentAddButton({ className }: AgentAddButtonProps) {
  return (
    <div className={cn("flex items-center gap-2 bg-muted p-3", className)}>
      <SokosumiIcon />
      <div className="flex flex-1 flex-col">
        <h2 className="text-base font-bold text-muted-foreground">
          Agents Gallery
        </h2>
        <p className="text-sm text-muted-foreground">browse agents</p>
      </div>
      <Button variant="outline" size="icon">
        <Plus />
      </Button>
    </div>
  );
}
