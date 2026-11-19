import { GSC_INSPECT_TOOL } from "@/lib/seo/native-gsc-inspection";
import {
  GSC_PROPERTIES_TOOL,
  GSC_STATS_TOOL,
} from "@/lib/seo/native-statistics";

const searchConsoleTools = [
  [GSC_PROPERTIES_TOOL, []],
  [
    GSC_STATS_TOOL,
    [
      "site_url",
      "start_date",
      "end_date",
      "dimensions",
      "search_type",
      "data_state",
      "dimension_filter_groups",
      "row_limit",
      "start_row",
    ],
  ],
  [GSC_INSPECT_TOOL, ["site_url", "inspection_url"]],
] as const;

export function searchConsoleToolDescriptors() {
  return searchConsoleTools.map(([slug, keys]) => ({
    slug,
    name: slug,
    readOnly: true,
    description: null,
    inputSchema: {
      properties: Object.fromEntries(keys.map((key) => [key, {}])),
    },
  }));
}
