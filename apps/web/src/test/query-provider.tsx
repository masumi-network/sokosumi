import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";

/**
 * The app shell's sidebar reads through react-query — the Projects rows are
 * fetched as soon as it mounts — so anything rendering the shell in a test
 * needs a client the way `(app)/layout.tsx` gives it one.
 *
 * A client per wrapper, so one test's cache never reaches the next.
 */
export function TestQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
          mutations: { gcTime: Number.POSITIVE_INFINITY },
        },
      }),
  );

  useEffect(() => () => client.clear(), [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
