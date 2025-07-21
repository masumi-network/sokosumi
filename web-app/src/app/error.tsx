"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useUnAuthenticatedErrorHandler } from "@/hooks/use-unauthenticated-error-handler";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { renderIfAuthenticated } = useUnAuthenticatedErrorHandler(error);

  return renderIfAuthenticated(
    <div className="container mx-auto flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{"Something went wrong"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            {
              "We encountered an unexpected error. Our team has been notified and we're working to resolve it."
            }
          </p>
          {error.digest && (
            <p className="text-muted-foreground text-xs">
              {`Error ID: ${error.digest}`}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button onClick={reset} variant="primary" className="w-full">
            {"Try Again"}
          </Button>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/">{"Go to Homepage"}</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>,
  );
}
