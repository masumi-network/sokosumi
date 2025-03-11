import { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface BoxProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: LucideIcon;
  text: string;
  className?: string;
}

export default function Box({
  icon: Icon,
  text,
  className,
  ...props
}: BoxProps) {
  return (
    <div
      className={cn(
        "relative mt-auto inline-flex flex-col items-start rounded-2xl border-2 border-slate-900 px-4 py-1.5",
        className,
      )}
      {...props}
    >
      <div>
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-1 text-sm">{text}</p>
    </div>
  );
}
