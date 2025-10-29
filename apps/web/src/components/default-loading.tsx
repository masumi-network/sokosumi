import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface DefaultLoadingProps {
  className?: string;
}

export default function DefaultLoading({ className }: DefaultLoadingProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[300px] items-center justify-center",
        className,
      )}
    >
      <Loader2 className="mr-2 h-8 w-8 animate-spin" />
    </div>
  );
}
