"use client";

import { useState } from "react";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ModalComponent = (
  props: React.ComponentProps<React.FC<ModalProps>>,
) => React.JSX.Element;

export default function useModal(Modal: ModalComponent) {
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
