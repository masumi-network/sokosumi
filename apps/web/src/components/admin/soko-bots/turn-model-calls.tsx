import type { AdminSokoBotTurn } from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";

type ModelCall = AdminSokoBotTurn["modelCalls"][number];

/** One precision for every row and total, so the sums can be checked. */
function callUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.0001) return "<$0.0001";
  return `$${value.toFixed(4)}`;
}

/** What answered the call; the asked-for model when the Gateway named none. */
function answered(call: ModelCall): string {
  return call.answeredModel ?? call.requestedModel;
}

function spendByModel(calls: readonly ModelCall[]) {
  const totals = new Map<string, { calls: number; costUsd: number }>();
  for (const call of calls) {
    const total = totals.get(answered(call)) ?? { calls: 0, costUsd: 0 };
    total.calls += 1;
    total.costUsd += call.costUsd;
    totals.set(answered(call), total);
  }
  return [...totals].sort(([, a], [, b]) => b.costUsd - a.costUsd);
}

/** Every model call of a turn: asked for, answered, where, and its cost. */
export async function TurnModelCalls({ calls }: { calls: ModelCall[] }) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Turns"),
    getFormatter(),
  ]);
  if (calls.length === 0)
    return (
      <p className="text-muted-foreground text-xs">{t("modelCallsEmpty")}</p>
    );
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">{t("spendByModel")}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {spendByModel(calls).map(([model, total]) => (
          <li key={model} className="tabular-nums">
            <span className="font-mono">{model}</span> × {total.calls} ·{" "}
            {callUsd(total.costUsd)}
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">{t("callRole")}</th>
              <th className="py-1 pr-3 font-medium">{t("callRequested")}</th>
              <th className="py-1 pr-3 font-medium">{t("callAnswered")}</th>
              <th className="py-1 pr-3 font-medium">{t("callProvider")}</th>
              <th className="py-1 pr-3 text-right font-medium">
                {t("callTokens")}
              </th>
              <th className="py-1 text-right font-medium">{t("callCost")}</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => (
              <tr
                key={call.id}
                className={call.failed ? "text-destructive" : undefined}
              >
                <td className="py-1 pr-3">
                  {call.role}
                  {call.label ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {call.label}
                    </span>
                  ) : null}
                </td>
                <td className="py-1 pr-3 font-mono">{call.requestedModel}</td>
                <td className="py-1 pr-3 font-mono">
                  {call.answeredModel ?? "—"}
                </td>
                <td className="py-1 pr-3">
                  {[call.provider, call.region].filter(Boolean).join(" · ") ||
                    "—"}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {format.number(call.inputTokens)} /{" "}
                  {format.number(call.cacheReadTokens)} /{" "}
                  {format.number(call.cacheWriteTokens)} /{" "}
                  {format.number(call.outputTokens)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {callUsd(call.costUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
