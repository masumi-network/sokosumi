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
  className = "w-full md:w-auto",
}: AgentDetailLinkProps) {
  const handleClick = () => {
    window.scrollTo(0, 0);
  };

  return (
    <Link
      className={className}
      href={`/agents/${agentId}`}
      onClick={handleClick}
    >
      {children}
    </Link>
  );
}

export { AgentDetailLink };
