import { Loader2 } from "lucide-react";

export function McpLoadingState() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
    </div>
  );
}
