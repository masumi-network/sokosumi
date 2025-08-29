import "@scalar/api-reference-react/style.css";

import { ApiReferenceReact } from "@scalar/api-reference-react";

export default async function ApiDocsPage() {
  return (
    <ApiReferenceReact
      configuration={{
        _integration: "nextjs",
        url: "openapi.json",
        hideClientButton: true,
        title: "Sokosumi API Documentation",
      }}
    />
  );
}
