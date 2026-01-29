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

export function ChatErrorFallback() {
  const t = useTranslations("App.Chat.Chat");

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="flex min-h-[400px] w-full items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-red-600">
            {t("errorTitle", { default: "Chat Error" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            {t("errorDescription", {
              default:
                "Something went wrong with the chat interface. Please try refreshing or contact support if the issue persists.",
            })}
          </p>
        </CardContent>
        <CardFooter>
          <Button onClick={handleRetry} variant="primary" className="w-full">
            {t("tryAgain", { default: "Try Again" })}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
