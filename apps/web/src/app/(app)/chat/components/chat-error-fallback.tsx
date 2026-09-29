"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ChatErrorFallback({ roomId }: { roomId?: string | null }) {
  const t = useTranslations("App.Chat.Chat");

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="flex min-h-[400px] w-full items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-semantic-destructive">
            {t("chatErrorTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            {t("errorFallbackDescription")}
          </p>
          {roomId ? (
            <p className="text-muted-foreground font-mono text-xs">
              {t("errorReference", { roomId })}
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button onClick={handleRetry} variant="primary" className="w-full">
            {t("tryAgain")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
