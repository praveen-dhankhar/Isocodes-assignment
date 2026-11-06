"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

// Last-resort boundary. No internals on screen; the digest identifies the error in the server logs.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 px-4 py-16">
      <TriangleAlert aria-hidden className="size-6 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        Nothing you entered was lost: every change is saved as soon as it is made. Try again{error.digest ? <> (reference <span className="font-mono">{error.digest}</span>)</> : null}.
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
