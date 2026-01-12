interface TaskDescriptionProps {
  title: string;
  description: string;
}

export function TaskDescription({ title, description }: TaskDescriptionProps) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm leading-6">{description}</p>
    </div>
  );
}
