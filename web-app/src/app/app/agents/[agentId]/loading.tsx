import { AgentModalContentSkeleton } from "@/components/agents";

export default function AgentDetailLoading() {
  return (
    <div className="mx-auto flex max-w-5xl justify-center px-4 py-8">
      <AgentModalContentSkeleton />
    </div>
  );
}
