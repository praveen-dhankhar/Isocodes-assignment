"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/result";

/**
 * Runs a review Server Action and refreshes the page data on success (ARCHITECTURE §11). A version conflict means
 * someone else changed the shipment: say so and show the latest. Other errors come back for inline display.
 */
export function useReviewAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run<T>(action: (input: unknown) => Promise<ActionResult<T>>, input: unknown): Promise<ActionResult<T>> {
    setPending(true);
    try {
      const result = await action(input);
      if (result.ok) router.refresh();
      else if (result.error.code === "VERSION_CONFLICT") {
        toast("Someone else changed this shipment", { description: "Showing the latest values. Check them and try again." });
        router.refresh();
      }
      return result;
    } finally {
      setPending(false);
    }
  }
  return { run, pending };
}
