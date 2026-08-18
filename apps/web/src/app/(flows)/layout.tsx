import { PreAppShell } from "@/components/pre-app-shell";

export default function FlowsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <PreAppShell>{children}</PreAppShell>;
}
