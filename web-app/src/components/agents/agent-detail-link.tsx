import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { auth } from "@/lib/auth/auth";
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
  return (
    <Suspense
      fallback={
        <AgentDetailLinkSkeleton className={className}>
          {children}
        </AgentDetailLinkSkeleton>
      }
    >
      <AgentDetailLinkInner className={className} agentId={agentId}>
        {children}
      </AgentDetailLinkInner>
    </Suspense>
  );
}

async function AgentDetailLinkInner({
  children,
  agentId,
  className,
}: AgentDetailLinkProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

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

function AgentDetailLinkSkeleton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string | undefined;
}) {
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

export { AgentDetailLink };
