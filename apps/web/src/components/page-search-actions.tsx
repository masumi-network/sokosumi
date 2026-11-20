import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** The Files toolbar pattern. Search and its trailing actions wrap together when the page is narrow. */
export function PageSearchActions({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "ms-auto flex w-full min-w-0 max-w-full flex-wrap items-center justify-end gap-2 empty:hidden @2xl/page-toolbar:w-auto",
        className,
      )}
    />
  );
}
