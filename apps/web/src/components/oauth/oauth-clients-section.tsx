"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { OAuthAuthorizedClients } from "./authorized-clients";
import { CreateOAuthClient } from "./create-client";
import { StartAuthorization } from "./start-authorization";

export function OAuthClientsSection() {
  const t = useTranslations("App.Account.OAuthClients");
  const [refreshKey, setRefreshKey] = useState(0);

  const handleClientCreated = () => {
    // Trigger refresh of the authorized clients list
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
          <div className="flex gap-2">
            <StartAuthorization />
            <CreateOAuthClient onSuccess={handleClientCreated} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <OAuthAuthorizedClients key={refreshKey} />
      </CardContent>
    </Card>
  );
}
