import { cn } from "@/lib/utils";

interface VerticalDividerProps {
  className?: string;
}

const VerticalDivider = ({ className }: VerticalDividerProps) => {
  return (
    <div
      className={cn("border-muted-foreground/20 h-8 border-r", className)}
    ></div>
  );
};

export default VerticalDivider;
