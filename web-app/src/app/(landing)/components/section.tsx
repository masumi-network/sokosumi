export default function Section({
  title,
  children,
  fullWidth = false,
}: {
  title: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <>
      <div className="container px-4 md:px-6">
        <h2 className="mb-6 text-3xl font-bold tracking-tighter">{title}</h2>
      </div>
      {fullWidth ? (
        children
      ) : (
        <div className="container mx-auto px-4 md:px-6">{children}</div>
      )}
    </>
  );
}
