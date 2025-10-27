import { formatRelative, FormatRelativeToken } from "date-fns";
import { enUS } from "date-fns/locale";

const formatRelativeLocale: Record<FormatRelativeToken, string> = {
  lastWeek: "'Last' eeee",
  yesterday: "'Yesterday'",
  today: "'Today'",
  tomorrow: "'Tomorrow'",
  nextWeek: "'Next' eeee",
  other: "PP",
};

export function getDateGroupKey(dateInput: Date | number): string | null {
  return formatRelative(new Date(dateInput), new Date(), {
    locale: {
      ...enUS,
      formatRelative: (token) => formatRelativeLocale[token],
    },
  });
}
