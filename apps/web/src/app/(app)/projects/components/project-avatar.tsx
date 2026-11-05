import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface ProjectAvatarProps {
  name: string;
  logo?: string | null;
  className?: string;
  /** For sizes the default `text-xs` initial does not fit, such as 16px. */
  fallbackClassName?: string;
}

export function ProjectAvatar({
  name,
  logo,
  className,
  fallbackClassName,
}: ProjectAvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "P";

  return (
    <Avatar
      className={cn("size-8 rounded-lg", className)}
      data-testid="project-avatar"
    >
      {logo ? <AvatarImage src={logo} alt="" /> : null}
      <AvatarFallback
        className={cn("rounded-lg text-xs font-medium", fallbackClassName)}
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}
