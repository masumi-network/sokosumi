function CardSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/80 border-foreground/20 flex w-full flex-col gap-6 rounded-xl border-1 p-6 backdrop-blur-3xl">
      {children}
    </div>
  );
}

export { CardSection };
