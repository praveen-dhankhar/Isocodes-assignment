"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

// Errors never show internals; the digest is an opaque id that identifies the error in the server logs.
export default function ShipmentsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col items-start gap-3 px-4 py-12">
      <TriangleAlert aria-hidden className="size-6 text-muted-foreground" />
      <h1 className="text-lg font-semibold">This page could not be loaded</h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        Nothing was changed. Try again; if it keeps failing, the database may be unreachable.
        {error.digest && (
          <>
            {" "}
            Reference <span className="font-mono">{error.digest}</span>.
          </>
        )}
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
