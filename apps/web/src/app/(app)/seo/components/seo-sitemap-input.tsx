"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { SeoField, seoFieldHelpId } from "./seo-form-fields";
import { SEO_MAX_PAGES } from "./seo-form-model";
import {
  importedSitemapHints,
  MAX_SITEMAP_IMPORT_BYTES,
} from "./seo-sitemap-model";

export function SeoSitemapInput({ seed }: { seed: string }) {
  const t = useTranslations("App.Seo.analysis");
  const [hints, setHints] = useState<string[]>([]);
  const [invalid, setInvalid] = useState(false);
  async function read(input: HTMLInputElement) {
    const file = input.files?.[0];
    setHints([]);
    setInvalid(false);
    input.setCustomValidity("");
    if (!file) return;
    input.setCustomValidity(t("sitemapReading"));
    try {
      if (file.size > MAX_SITEMAP_IMPORT_BYTES) throw new Error("Size limit");
      const urls = importedSitemapHints(await file.text(), seed);
      if (file !== input.files?.[0]) return;
      setHints(urls);
      input.setCustomValidity("");
    } catch {
      if (file !== input.files?.[0]) return;
      setInvalid(true);
      input.setCustomValidity(t("sitemapInvalid"));
    }
  }
  return (
    <>
      <SeoField
        id="seo-custom-sitemap"
        label={t("customSitemap")}
        help={t("customSitemapHelp")}
      >
        <Input
          id="seo-custom-sitemap"
          name="publicSitemapUrl"
          type="url"
          aria-describedby={seoFieldHelpId("seo-custom-sitemap")}
        />
      </SeoField>
      <SeoField
        id="seo-import-sitemap"
        label={t("importSitemap")}
        help={t("importSitemapHelp", { count: SEO_MAX_PAGES })}
      >
        <Input
          id="seo-import-sitemap"
          type="file"
          accept=".xml,application/xml,text/xml"
          aria-describedby={seoFieldHelpId("seo-import-sitemap")}
          onChange={(event) => void read(event.currentTarget)}
        />
        {invalid && <p role="alert">{t("sitemapInvalid")}</p>}
        {hints.length > 0 && (
          <ul className="break-all text-sm">
            {hints.map((url) => (
              <li key={url}>
                {url}
                <input type="hidden" name="sitemapPageHints" value={url} />
              </li>
            ))}
          </ul>
        )}
      </SeoField>
    </>
  );
}
