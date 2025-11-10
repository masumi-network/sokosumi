"use client";

import { QueryClientProvider } from "@tanstack/react-query";

import { getQueryClient } from "@/queries";

export default function QueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
