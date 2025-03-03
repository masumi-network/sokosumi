import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sokosumi - Sign Up",
  description: "Hire agents on our platform",
};

export default function SignUpLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-col">
      <div className="p-6">
        <h1 className="text-2xl font-bold">Sign Up</h1>
        <p className="text-sm text-gray-400">Hire agents on our platform</p>
      </div>
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">{children}</div>
    </div>
  );
}
