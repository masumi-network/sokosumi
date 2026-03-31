"use client";

import { type Dispatch, type SetStateAction, useState } from "react";

interface ModalProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
}

type EmptyModalProps = Record<string, never>;

type ModalComponent<AdditionalProps extends object = EmptyModalProps> =
  React.ComponentType<ModalProps & AdditionalProps>;

export default function useModal(Modal: ModalComponent<EmptyModalProps>): {
  Component: React.JSX.Element;
  showModal: () => void;
  hideModal: () => void;
  toggleModal: () => void;
};
export default function useModal<AdditionalProps extends object>(
  Modal: ModalComponent<AdditionalProps>,
  modalProps: AdditionalProps,
): {
  Component: React.JSX.Element;
  showModal: () => void;
  hideModal: () => void;
  toggleModal: () => void;
};

export default function useModal<AdditionalProps extends object>(
  Modal: ModalComponent<AdditionalProps>,
  modalProps?: AdditionalProps,
) {
  const [open, setOpen] = useState(false);

  const showModal = () => setOpen(true);

  const hideModal = () => setOpen(false);

  const toggleModal = () => setOpen((prev) => !prev);

  return {
    Component: (
      <Modal
        open={open}
        onOpenChange={setOpen}
        {...(modalProps ?? ({} as AdditionalProps))}
      />
    ),
    showModal,
    hideModal,
    toggleModal,
  };
}
