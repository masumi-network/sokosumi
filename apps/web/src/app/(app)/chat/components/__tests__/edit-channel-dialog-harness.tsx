import { type ComponentProps, useState } from "react";

import { EditChannelDialog } from "../edit-channel-dialog";

/**
 * Mirrors the room shell, which owns the dialog's open flag because the dialog
 * has two ways in: the title beside the room name and a channel row's menu.
 */
export function ShellOwnedEditChannelDialog(
  props: Omit<
    ComponentProps<typeof EditChannelDialog>,
    "open" | "onOpenChange"
  >,
) {
  const [open, setOpen] = useState(false);
  return <EditChannelDialog {...props} open={open} onOpenChange={setOpen} />;
}
