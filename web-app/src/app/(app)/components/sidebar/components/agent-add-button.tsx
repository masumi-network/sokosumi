import { Plus } from "lucide-react";

import { SokosumiIcon } from "@/components/masumi-icons";
import { Button } from "@/components/ui/button";

export default function AgentAddButton() {
  return (
    <div className="flex items-center gap-2 p-2">
      <SokosumiIcon />
      <div className="flex flex-1 flex-col">
        <h2 className="text-muted-foreground text-base font-bold">
          Agents Gallery
        </h2>
        <p className="text-muted-foreground text-xs">browse agents</p>
      </div>
      <Button variant="outline" size="icon">
        <Plus />
      </Button>
    </div>
  );
}
