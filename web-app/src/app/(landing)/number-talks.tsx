import { TrendingDown } from "lucide-react";
import { Loader } from "lucide-react";
import { TrendingUp } from "lucide-react";

import IconTitleDescription from "@/components/icon-title-description";

import HorizontalScroll from "./components/horizontal-scroll";
export default function NumberTalks() {
  return (
    <>
      <HorizontalScroll>
        <IconTitleDescription
          icon={Loader}
          title="2 hours"
          description="to complete a full team report something something something"
        />
        <IconTitleDescription
          icon={TrendingDown}
          title="42% less costs"
          description="of something something because something"
        />
        <IconTitleDescription
          icon={TrendingUp}
          title="69% more free time"
          description="because team is not something something too much"
        />
      </HorizontalScroll>
    </>
  );
}
