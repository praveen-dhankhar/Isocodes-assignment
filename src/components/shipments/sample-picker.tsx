"use client";

import { Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/mono";
import { createSampleShipment } from "@/server/actions/shipments";

/** PRD F1.4 "Load sample set": a new shipment with the bundled files attached as if uploaded. */
export function SamplePicker({ sets }: { sets: Array<{ ref: string; title: string; documents: number }> }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(ref: string) {
    setLoading(ref);
    setError(null);
    const result = await createSampleShipment({ sampleRef: ref });
    if (result.ok) {
      router.push(`/shipments/${result.data.shipmentId}`);
      return; // keep the row busy until the review screen replaces this one
    }
    setError(result.error.message);
    setLoading(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y rounded-lg border">
        {sets.map((s) => (
          <li key={s.ref} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{s.title}</div>
              <div className="text-xs text-muted-foreground">
                Based on <Mono>{s.ref}</Mono> · {s.documents === 3 ? "all three documents" : `${s.documents} of 3 documents`}
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={loading !== null} onClick={() => void load(s.ref)}>
              {loading === s.ref && <Loader aria-hidden className="animate-spin motion-reduce:animate-none" />}
              {loading === s.ref ? "Loading…" : "Load"}
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
