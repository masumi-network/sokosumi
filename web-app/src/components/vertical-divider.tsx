import { cn } from "@/lib/utils";

interface VerticalDividerProps {
  className?: string;
}

export default function VerticalDivider({ className }: VerticalDividerProps) {
  return (
    <div
      className={cn("border-muted-foreground/20 h-8 border-r", className)}
    ></div>
  );
}
