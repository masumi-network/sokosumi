import { cn } from "@/lib/utils";

function CardSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex w-full flex-col", className)}>{children}</div>
  );
}

export { CardSection };
