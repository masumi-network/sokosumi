import { AgentModal } from "@/components/agents";

export default async function AgentModalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AgentModal>{children}</AgentModal>;
}
