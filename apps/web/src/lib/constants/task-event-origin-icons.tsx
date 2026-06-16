import { TaskEventOrigin } from "@sokosumi/utils";
import {
  CircleHelp,
  Mail,
  MessageSquare,
  type SVGAttributes,
} from "lucide-react";
import type { ComponentType } from "react";
import { PiMicrosoftTeamsLogo } from "react-icons/pi";
import {
  SiDiscord,
  SiGithub,
  SiLinear,
  SiSignal,
  SiSlack,
  SiTelegram,
  SiWhatsapp,
} from "react-icons/si";

import { MasumiMessengerIcon, SokosumiIcon } from "@/components/masumi-logos";

function SokosumiOriginIcon(
  props: Omit<React.SVGProps<SVGSVGElement>, "width" | "height"> & {
    size?: number;
  },
) {
  return <SokosumiIcon {...props} animated={false} />;
}

function MasumiMessengerOriginIcon(
  props: Omit<React.SVGProps<SVGSVGElement>, "width" | "height"> & {
    size?: number;
  },
) {
  return <MasumiMessengerIcon {...props} animated={false} />;
}

export interface TaskEventOriginIconProps
  extends Omit<SVGAttributes, "ref" | "size" | "width" | "height"> {
  size?: number;
  absoluteStrokeWidth?: boolean;
}

export type TaskEventOriginIconComponent =
  ComponentType<TaskEventOriginIconProps>;

export const ORIGIN_ICON_MAP: Record<
  TaskEventOrigin,
  TaskEventOriginIconComponent
> = {
  [TaskEventOrigin.SLACK]: SiSlack,
  [TaskEventOrigin.TEAMS]: PiMicrosoftTeamsLogo,
  [TaskEventOrigin.EMAIL]: Mail,
  [TaskEventOrigin.LINEAR]: SiLinear,
  [TaskEventOrigin.GITHUB]: SiGithub,
  [TaskEventOrigin.WHATSAPP]: SiWhatsapp,
  [TaskEventOrigin.TELEGRAM]: SiTelegram,
  [TaskEventOrigin.SIGNAL]: SiSignal,
  [TaskEventOrigin.DISCORD]: SiDiscord,
  [TaskEventOrigin.CHAT]: MessageSquare,
  [TaskEventOrigin.MESSENGER]: MasumiMessengerOriginIcon,
  [TaskEventOrigin.SOKOSUMI]: SokosumiOriginIcon,
  [TaskEventOrigin.UNKNOWN]: CircleHelp,
};

export const ORIGIN_APP_NAME_KEY_MAP: Record<TaskEventOrigin, string> = {
  [TaskEventOrigin.SLACK]: "slack",
  [TaskEventOrigin.TEAMS]: "teams",
  [TaskEventOrigin.EMAIL]: "email",
  [TaskEventOrigin.LINEAR]: "linear",
  [TaskEventOrigin.GITHUB]: "github",
  [TaskEventOrigin.WHATSAPP]: "whatsapp",
  [TaskEventOrigin.TELEGRAM]: "telegram",
  [TaskEventOrigin.SIGNAL]: "signal",
  [TaskEventOrigin.DISCORD]: "discord",
  [TaskEventOrigin.CHAT]: "chat",
  [TaskEventOrigin.MESSENGER]: "messenger",
  [TaskEventOrigin.SOKOSUMI]: "sokosumi",
  [TaskEventOrigin.UNKNOWN]: "unknown",
};
