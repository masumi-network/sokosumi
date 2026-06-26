import { getUserMetadata } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import {
  DesignMdLoadError,
  fetchDesignMdMarkdown,
} from "@/components/design-md/design-md-edit-page-shared";
import { DesignMdEditor } from "@/components/design-md-editor/design-md-editor";
import { getSession } from "@/lib/auth/auth.server";

export default async function AccountDesignMdEditPage() {
  const t = await getTranslations("App.DesignMd");
  const session = await getSession();
  const userMetadata = getUserMetadata(session?.user.metadata);
  const designMdUrl = userMetadata.designMdUrl;
  const returnHref = "/account";

  if (!designMdUrl) {
    return (
      <DesignMdLoadError
        backHref={returnHref}
        backLabel={t("editBackToProfile")}
        description={t("editLoadErrorDescription")}
        title={t("editUnavailableTitle")}
      />
    );
  }

  const loadResult = await fetchDesignMdMarkdown(designMdUrl);

  if ("error" in loadResult) {
    return (
      <DesignMdLoadError
        backHref={returnHref}
        backLabel={t("editBackToProfile")}
        description={t("editLoadErrorDescription")}
        title={t("editLoadErrorTitle")}
      />
    );
  }

  return (
    <DesignMdEditor
      initialMarkdown={loadResult.markdown}
      owner={{ type: "user" }}
      returnHref={returnHref}
    />
  );
}
