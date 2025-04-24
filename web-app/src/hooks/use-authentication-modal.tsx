"use client";

import { useState } from "react";

import AuthenticationModal from "@/components/modals/authentication-modal";

export default function useAuthenticationModal() {
  const [open, setOpen] = useState(false);

  const showModal = () => setOpen(true);

  return {
    Component: <AuthenticationModal open={open} onOpenChange={setOpen} />,
    showModal,
  };
}
