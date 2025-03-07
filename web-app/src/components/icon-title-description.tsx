import { LucideIcon } from "lucide-react";

interface IconTitleDescriptionProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export default function IconTitleDescription({
  icon: Icon,
  title = "Component Title",
  description = "This is a description text that can span up to two lines. It provides additional context about the component or its content.",
}: IconTitleDescriptionProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0">
          <Icon className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-6xl font-normal tracking-tight">{title}</h2>
      </div>
      <p className="line-clamp-2 pl-14 text-muted-foreground">{description}</p>
    </div>
  );
}
