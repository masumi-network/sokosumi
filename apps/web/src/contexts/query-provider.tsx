"use client";

import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { useRetireQueryClient } from "@/hooks/effects/use-retire-query-client";
import { useSession } from "@/lib/auth/auth.client";
import { createQueryClient } from "@/queries/get-query-client";

type SessionOwner = string | null | undefined;

interface SessionQueryClientState {
  owner: SessionOwner;
  client: QueryClient;
  generation: number;
}

function resolveInitialOwner(
  userId: string | undefined,
  isPending: boolean,
): SessionOwner {
  if (userId) return userId;
  return isPending ? undefined : null;
}

export default function QueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id || undefined;

  const [state, setState] = useState<SessionQueryClientState>(() => ({
    owner: resolveInitialOwner(userId, isPending),
    client: createQueryClient(),
    generation: 0,
  }));

  if (state.owner === undefined) {
    if (userId) {
      // Adopt the boot client once the initial session resolves so SSR-hydrated
      // queries stay intact instead of remounting on first paint.
      setState({
        owner: userId,
        client: state.client,
        generation: state.generation,
      });
    } else if (!isPending) {
      setState({
        owner: null,
        client: createQueryClient(),
        generation: state.generation + 1,
      });
    }
  } else {
    const nextOwner = userId ?? null;
    if (nextOwner !== state.owner) {
      setState({
        owner: nextOwner,
        client: createQueryClient(),
        generation: state.generation + 1,
      });
    }
  }

  useRetireQueryClient(state.client);

  return (
    <QueryClientProvider key={state.generation} client={state.client}>
      {children}
    </QueryClientProvider>
  );
}
