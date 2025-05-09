"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  const pathname = usePathname();

  if (pathname.startsWith("/app")) {
    return (
      <Link className={className} href={`/app/agents/${agentId}`}>
        {children}
      </Link>
    );
  }

  return (
    <Link className={className} href={`/agents/${agentId}`}>
      {children}
    </Link>
  );
}

export { AgentDetailLink };
