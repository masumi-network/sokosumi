import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface ProjectAvatarProps {
  name: string;
  logo?: string | null;
  className?: string;
}

export function ProjectAvatar({ name, logo, className }: ProjectAvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "P";

  return (
    <Avatar
      className={cn("size-8 rounded-lg", className)}
      data-testid="project-avatar"
    >
      {logo ? <AvatarImage src={logo} alt="" /> : null}
      <AvatarFallback className="rounded-lg text-xs font-medium">
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}
