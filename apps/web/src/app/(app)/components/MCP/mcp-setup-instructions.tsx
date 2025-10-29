"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

export function McpSetupInstructions() {
  const t = useTranslations("App.MCP.Instructions");

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">{t("title")}</h3>

      {/* Visual Demo */}
      <div className="bg-muted/30 rounded-lg border p-4">
        <Image
          src="/images/mcp-setup-demo.gif"
          alt="MCP Setup Demo - Visual guide showing how to connect Claude to Sokosumi"
          width={600}
          height={400}
          className="w-full rounded-md"
          unoptimized // Allows GIFs to animate
        />
      </div>

      <ol className="text-muted-foreground space-y-3 text-sm">
        <li className="flex gap-2">
          <span className="text-foreground font-semibold">{"1."}</span>
          <span>{t("step1")}</span>
        </li>
        <li className="flex gap-2">
          <span className="text-foreground font-semibold">{"2."}</span>
          <span>{t("step2")}</span>
        </li>
        <li className="flex gap-2">
          <span className="text-foreground font-semibold">{"3."}</span>
          <span>{t("step3")}</span>
        </li>
        <li className="flex gap-2">
          <span className="text-foreground font-semibold">{"3."}</span>
          <span>{t("step4")}</span>
        </li>
        <li className="flex gap-2">
          <span className="text-foreground font-semibold">{"4."}</span>
          <div>
            <span>{t("step5.text")}</span>
            <div className="bg-muted mt-1 rounded p-2 font-mono text-xs">
              {t("step5.example")}
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}
