"use client";

import { CircleX, Clock, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DOC_LABEL } from "@/domain/fields";
import type { ShipmentStatusDTO } from "@/server/queries/shipments";

const POLL_MS = 2000;
const signature = (s: Pick<ShipmentStatusDTO, "version" | "documents">) => `${s.version}:${s.documents.map((d) => `${d.id}=${d.status}`).join(",")}`;

/**
 * PRD F1.5/F2: extraction starts for every uploaded document when the review screen opens, and the screen polls
 * GET /status every 2 s while anything is extracting (ARCHITECTURE §11). A failed document offers Retry here;
 * "Enter manually" sits with the review actions.
 */
export function ExtractionProgress({ shipment }: { shipment: ShipmentStatusDTO }) {
  const router = useRouter();
  const started = useRef(new Set<string>());
  const [running, setRunning] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const start = async (documentId: string) => {
    started.current.add(documentId);
    setRunning((r) => [...r, documentId]);
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([id]) => id !== documentId)));
    try {
      const res = await fetch(`/api/shipments/${shipment.id}/documents/${documentId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      // 409 means someone else already started it; the poll picks up their result.
      if (!res.ok && res.status !== 409) setErrors((e) => ({ ...e, [documentId]: "Could not start extraction. Try again." }));
    } catch {
      setErrors((e) => ({ ...e, [documentId]: "The server could not be reached. Try again." }));
    } finally {
      setRunning((r) => r.filter((id) => id !== documentId));
      router.refresh();
    }
  };

  const waiting = shipment.documents.filter((d) => d.status === "UPLOADED").map((d) => d.id);
  useEffect(() => {
    for (const id of waiting) if (!started.current.has(id)) void start(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once per uploaded document
  }, [waiting.join(",")]);

  const busy = running.length > 0 || shipment.documents.some((d) => d.status === "EXTRACTING");
  const current = signature(shipment);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/shipments/${shipment.id}/status`, { cache: "no-store" }).catch(() => null);
      const next: unknown = res?.ok ? await res.json() : null;
      if (next && typeof next === "object" && "version" in next && "documents" in next && signature(next as ShipmentStatusDTO) !== current) router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [busy, current, shipment.id, router]);

  const rows = shipment.documents.filter((d) => d.status === "UPLOADED" || d.status === "EXTRACTING" || d.status === "FAILED" || errors[d.id]);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Extraction" aria-live="polite" className="flex flex-col gap-2 border-b p-4">
      {rows.map((d) => {
        const inFlight = d.status === "EXTRACTING" || running.includes(d.id);
        return (
          <div key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
            {inFlight ? <Loader aria-hidden className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" /> : d.status === "FAILED" ? <CircleX aria-hidden className="size-4 text-muted-foreground" /> : <Clock aria-hidden className="size-4 text-muted-foreground" />}
            <span className="font-medium">{DOC_LABEL[d.docType]}</span>
            <span className="text-muted-foreground">
              {inFlight ? `Reading ${d.pageCount === 1 ? "the page" : `${d.pageCount} pages`}…` : d.status === "FAILED" ? (d.errorMessage ?? "Extraction failed") : "Waiting to start"}
            </span>
            {errors[d.id] && <span>{errors[d.id]}</span>}
            {!inFlight && (d.status === "FAILED" || errors[d.id]) && (
              <Button size="xs" variant="outline" className="ml-auto" onClick={() => void start(d.id)}>
                Retry
              </Button>
            )}
          </div>
        );
      })}
    </section>
  );
}
