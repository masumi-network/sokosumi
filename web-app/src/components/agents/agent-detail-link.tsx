"use client";

import Link from "next/link";

import useIsClient from "@/hooks/use-is-client";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";

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
  const { data: session, isPending } = useSession();
  const isClient = useIsClient();

  if (!isClient || isPending) {
    return (
      <div
        className={cn(
          "pointer-events-none animate-pulse bg-transparent",
          className,
        )}
      >
        {children}
      </div>
    );
  }

  if (!session) {
    return (
      <Link className={className} href={`/agents/${agentId}`}>
        {children}
      </Link>
    );
  }

  return (
    <Link className={className} href={`/app/agents/${agentId}`}>
      {children}
    </Link>
  );
}

export { AgentDetailLink };
