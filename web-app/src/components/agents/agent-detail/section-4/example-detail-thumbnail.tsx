import { Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExampleOutput } from "@/prisma/generated/client";

interface ExampleDetailThumbnailProps {
  exampleOutput: ExampleOutput;
  onClick?: (() => void) | undefined;
  showMaximizeButton?: boolean | undefined;
  className?: string | undefined;
}

export default function ExampleDetailThumbnail({
  exampleOutput,
  onClick,
  className,
  showMaximizeButton = true,
}: ExampleDetailThumbnailProps) {
  const { name, mimeType } = exampleOutput;

  return (
    <div
      className={cn(
        "border-quinary bg-accent relative flex h-60 w-60 flex-col items-center justify-center gap-2 rounded-lg border shadow-sm",
        {
          group: showMaximizeButton,
        },
        className,
      )}
      onClick={onClick}
    >
      <div className="m-4">
        <h3 className="line-clamp-2 w-full text-center text-sm font-medium">
          {name}
        </h3>
        <p className="text-muted-foreground w-full truncate text-center text-xs">
          {mimeType}
        </p>
        <div className="absolute top-2 right-2 hidden group-hover:block">
          <Button variant="outline" size="icon">
            <Maximize2 />
          </Button>
        </div>
      </div>
    </div>
  );
}
