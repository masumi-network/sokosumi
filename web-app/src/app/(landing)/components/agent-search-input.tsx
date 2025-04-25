"use client";
import { useRouter } from "next/navigation";

import InputWithButton from "@/components/input-with-button";

export default function AgentSearchInput() {
  const router = useRouter();

  return (
    <InputWithButton
      onSubmit={(query) => {
        router.push(`/agents?query=${query}`);
      }}
    />
  );
}
