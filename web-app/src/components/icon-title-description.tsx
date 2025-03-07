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
        <div className="shrink-0">
          <Icon className="text-primary h-10 w-10" />
        </div>
        <h2 className="text-6xl font-normal tracking-tight">{title}</h2>
      </div>
      <p className="text-muted-foreground line-clamp-2 pl-14">{description}</p>
    </div>
  );
}
