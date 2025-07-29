"use client";

import Link from "next/link";

interface AgentDetailLinkProps {
  children: React.ReactNode;
  agentId: string;
  className?: string | undefined;
}

function AgentDetailLink({
  children,
  agentId,
  className,
}: AgentDetailLinkProps) {
  return (
    <Link className={className} href={`/agents/${agentId}`}>
      {children}
    </Link>
  );
}

export { AgentDetailLink };
