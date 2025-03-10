export default function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="container px-4 md:px-6">
        <h2 className="mb-6 text-3xl font-bold tracking-tighter">{title}</h2>
      </div>
      {children}
    </>
  );
}
