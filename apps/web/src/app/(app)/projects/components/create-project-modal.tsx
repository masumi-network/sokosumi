"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  useTransition,
} from "react";

import { CreateProjectWizard } from "./create-project-wizard";

interface CreateProjectModalContextType {
  open: boolean;
  formInstanceKey: number;
  handleOpen: () => void;
  handleClose: () => void;
}

const CreateProjectModalContext = createContext<CreateProjectModalContextType>({
  open: false,
  formInstanceKey: 0,
  handleOpen: () => {},
  handleClose: () => {},
});

export function useCreateProjectModal() {
  return useContext(CreateProjectModalContext);
}

interface CreateProjectModalProviderProps {
  children: React.ReactNode;
  initialOpen?: boolean;
}

export function CreateProjectModalProvider({
  children,
  initialOpen = false,
}: CreateProjectModalProviderProps) {
  const [open, setOpen] = useState(initialOpen);
  const [formInstanceKey, setFormInstanceKey] = useState(0);
  const [, startOpenTransition] = useTransition();

  const handleOpen = useCallback(() => {
    // Keep the click's next paint cheap: button feedback first, modal mount
    // as a transition so Interaction to Next Paint stays responsive.
    startOpenTransition(() => {
      setFormInstanceKey((key) => key + 1);
      setOpen(true);
    });
  }, [startOpenTransition]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <CreateProjectModalContext.Provider
      value={{
        open,
        formInstanceKey,
        handleOpen,
        handleClose,
      }}
    >
      {children}
    </CreateProjectModalContext.Provider>
  );
}

export function CreateProjectModal() {
  const { open, handleClose, formInstanceKey } = useCreateProjectModal();
  const router = useRouter();
  const pathname = usePathname();
  const [hasOpened, setHasOpened] = useState(open);

  if (open && !hasOpened) {
    setHasOpened(true);
  }

  const stripCreateProjectSearchParams = useCallback(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    if (!params.has("create")) return;

    params.delete("create");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [pathname, router]);

  const handleDismiss = useCallback(() => {
    stripCreateProjectSearchParams();
    handleClose();
  }, [handleClose, stripCreateProjectSearchParams]);

  function handleSuccess() {
    handleClose();
    stripCreateProjectSearchParams();
    router.refresh();
  }

  if (!hasOpened) {
    return null;
  }

  return (
    <CreateProjectWizard
      key={formInstanceKey}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleDismiss();
      }}
      creationSource="projects_page"
      onSuccess={handleSuccess}
    />
  );
}
