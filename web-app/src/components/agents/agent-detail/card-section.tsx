function CardSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="agent-detail-card flex w-full flex-col">{children}</div>
  );
}

export { CardSection };
