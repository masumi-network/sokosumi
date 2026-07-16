import {
  CircleHelp,
  Mail,
  MessageSquare,
  type SVGAttributes,
} from "lucide-react";
import type { ComponentType } from "react";
import {
  SiDiscord,
  SiGithub,
  SiLinear,
  SiSignal,
  SiTelegram,
  SiWhatsapp,
} from "react-icons/si";
import { MasumiMessengerIcon, SokosumiIcon } from "@/components/masumi-logos";
import { Channel } from "@/lib/clients/generated/core";

export interface ChannelIconProps
  extends Omit<SVGAttributes, "ref" | "size" | "width" | "height"> {
  size?: number;
  absoluteStrokeWidth?: boolean;
}

export type ChannelIconComponent = ComponentType<ChannelIconProps>;

// Simple Icons removed Slack (Salesforce trademark). Archived v9 path, currentColor.
const SLACK_ICON_PATH =
  "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z";

// Microsoft Teams is not in current Simple Icons; archived v9 path, currentColor.
const TEAMS_ICON_PATH =
  "M20.625 8.127q-.55 0-1.025-.205-.475-.205-.832-.563-.358-.357-.563-.832Q18 6.053 18 5.502q0-.54.205-1.02t.563-.837q.357-.358.832-.563.474-.205 1.025-.205.54 0 1.02.205t.837.563q.358.357.563.837.205.48.205 1.02 0 .55-.205 1.025-.205.475-.563.832-.357.358-.837.563-.48.205-1.02.205zm0-3.75q-.469 0-.797.328-.328.328-.328.797 0 .469.328.797.328.328.797.328.469 0 .797-.328.328-.328.328-.797 0-.469-.328-.797-.328-.328-.797-.328zM24 10.002v5.578q0 .774-.293 1.46-.293.685-.803 1.194-.51.51-1.195.803-.686.293-1.459.293-.445 0-.908-.105-.463-.106-.85-.329-.293.95-.855 1.729-.563.78-1.319 1.336-.756.557-1.67.861-.914.305-1.898.305-1.148 0-2.162-.398-1.014-.399-1.805-1.102-.79-.703-1.312-1.664t-.674-2.086h-5.8q-.411 0-.704-.293T0 16.881V6.873q0-.41.293-.703t.703-.293h8.59q-.34-.715-.34-1.5 0-.727.275-1.365.276-.639.75-1.114.475-.474 1.114-.75.638-.275 1.365-.275t1.365.275q.639.276 1.114.75.474.475.75 1.114.275.638.275 1.365t-.275 1.365q-.276.639-.75 1.113-.475.475-1.114.75-.638.276-1.365.276-.188 0-.375-.024-.188-.023-.375-.058v1.078h10.875q.469 0 .797.328.328.328.328.797zM12.75 2.373q-.41 0-.78.158-.368.158-.638.434-.27.275-.428.639-.158.363-.158.773 0 .41.158.78.159.368.428.638.27.27.639.428.369.158.779.158.41 0 .773-.158.364-.159.64-.428.274-.27.433-.639.158-.369.158-.779 0-.41-.158-.773-.159-.364-.434-.64-.275-.275-.639-.433-.363-.158-.773-.158zM6.937 9.814h2.25V7.94H2.814v1.875h2.25v6h1.875zm10.313 7.313v-6.75H12v6.504q0 .41-.293.703t-.703.293H8.309q.152.809.556 1.5.405.691.985 1.19.58.497 1.318.779.738.281 1.582.281.926 0 1.746-.352.82-.351 1.436-.966.615-.616.966-1.43.352-.815.352-1.752zm5.25-1.547v-5.203h-3.75v6.855q.305.305.691.452.387.146.809.146.469 0 .879-.176.41-.175.715-.48.304-.305.48-.715t.176-.879Z";

function createSimpleIconChannel(pathD: string): ChannelIconComponent {
  return function SimpleIconChannel({
    size,
    className,
    ...props
  }: ChannelIconProps) {
    return (
      <svg
        role="img"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        fill="currentColor"
        {...props}
      >
        <path d={pathD} />
      </svg>
    );
  };
}

const SlackChannelIcon = createSimpleIconChannel(SLACK_ICON_PATH);
const TeamsChannelIcon = createSimpleIconChannel(TEAMS_ICON_PATH);

function SokosumiChannelIcon(
  props: Omit<React.SVGProps<SVGSVGElement>, "width" | "height"> & {
    size?: number;
  },
) {
  return <SokosumiIcon {...props} animated={false} />;
}

function MasumiMessengerChannelIcon(
  props: Omit<React.SVGProps<SVGSVGElement>, "width" | "height"> & {
    size?: number;
  },
) {
  return <MasumiMessengerIcon {...props} animated={false} />;
}

export const CHANNEL_ICON_MAP: Record<Channel, ChannelIconComponent> = {
  [Channel.SLACK]: SlackChannelIcon,
  [Channel.TEAMS]: TeamsChannelIcon,
  [Channel.EMAIL]: Mail,
  [Channel.LINEAR]: SiLinear,
  [Channel.GITHUB]: SiGithub,
  [Channel.WHATSAPP]: SiWhatsapp,
  [Channel.TELEGRAM]: SiTelegram,
  [Channel.SIGNAL]: SiSignal,
  [Channel.DISCORD]: SiDiscord,
  [Channel.CHAT]: MessageSquare,
  [Channel.MESSENGER]: MasumiMessengerChannelIcon,
  [Channel.SOKOSUMI]: SokosumiChannelIcon,
  [Channel.UNKNOWN]: CircleHelp,
};

export const CHANNEL_APP_NAME_KEY_MAP: Record<Channel, string> = {
  [Channel.SLACK]: "slack",
  [Channel.TEAMS]: "teams",
  [Channel.EMAIL]: "email",
  [Channel.LINEAR]: "linear",
  [Channel.GITHUB]: "github",
  [Channel.WHATSAPP]: "whatsapp",
  [Channel.TELEGRAM]: "telegram",
  [Channel.SIGNAL]: "signal",
  [Channel.DISCORD]: "discord",
  [Channel.CHAT]: "chat",
  [Channel.MESSENGER]: "messenger",
  [Channel.SOKOSUMI]: "sokosumi",
  [Channel.UNKNOWN]: "unknown",
};
