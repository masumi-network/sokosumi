import { cn } from "@/lib/utils"

function BottomNavigation({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bottom-navigation"
      className={cn("md:hidden bg-muted text-card-foreground flex flex-row items-center p-2 border shadow-sm animate-in fade-in-0 rounded-md fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { BottomNavigation }
