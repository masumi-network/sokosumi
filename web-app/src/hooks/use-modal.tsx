"use client";

import { useState } from "react";

type ModalComponent = (
  props: React.ComponentProps<
    React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }>
  >,
) => React.JSX.Element;

interface UseModalProps {
  Modal: ModalComponent;
}

export default function useModal({ Modal }: UseModalProps) {
  const [open, setOpen] = useState(false);

  const showModal = () => setOpen(true);

  const hideModal = () => setOpen(false);

  const toggleModal = () => setOpen((prev) => !prev);

  return {
    Component: <Modal open={open} onOpenChange={setOpen} />,
    showModal,
    hideModal,
    toggleModal,
  };
}
