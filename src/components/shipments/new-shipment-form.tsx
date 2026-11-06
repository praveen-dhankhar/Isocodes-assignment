"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DocType } from "@/domain/fields";
import { createShipment } from "@/server/actions/shipments";
import { uploadFile } from "./upload";
import { UploadSlot, type SlotState } from "./upload-slot";

const SLOTS: Array<{ docType: DocType; label: string; hint: string }> = [
  { docType: "INVOICE", label: "Commercial invoice", hint: "INV" },
  { docType: "PACKING_LIST", label: "Packing list", hint: "PL" },
  { docType: "BILL_OF_LADING", label: "Bill of lading", hint: "B/L" },
];
const EMPTY: Record<DocType, SlotState> = { INVOICE: { phase: "empty" }, PACKING_LIST: { phase: "empty" }, BILL_OF_LADING: { phase: "empty" } };

interface Option {
  id: string;
  name: string;
}

/**
 * S3 (PRD F1): importer and supplier, then up to three files. The shipment is created once; a failed upload can be
 * fixed and retried into the same shipment. Extraction starts on the review screen, which opens when uploads finish.
 */
export function NewShipmentForm({ importers, suppliers }: { importers: Option[]; suppliers: Option[] }) {
  const router = useRouter();
  const [importerId, setImporterId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [slots, setSlots] = useState(EMPTY);
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const setSlot = (docType: DocType, next: SlotState) => setSlots((s) => ({ ...s, [docType]: next }));
  const pending = SLOTS.filter(({ docType }) => slots[docType].phase === "ready" || slots[docType].phase === "failed");
  const uploadedAny = SLOTS.some(({ docType }) => slots[docType].phase === "uploaded");
  const blocked = !importerId || !supplierId ? "Choose the importer and the supplier first" : pending.length === 0 ? "Add at least one document" : null;

  async function submit() {
    setBusy(true);
    setFormError(null);
    let id = shipmentId;
    if (!id) {
      const created = await createShipment({ importerId, supplierId });
      if (!created.ok) {
        setFormError(created.error.message);
        setBusy(false);
        return;
      }
      id = created.data.shipmentId;
      setShipmentId(id);
    }
    const results = await Promise.all(
      pending.map(async ({ docType }) => {
        const slot = slots[docType];
        if (slot.phase !== "ready" && slot.phase !== "failed") return true;
        const file = slot.file;
        setSlot(docType, { phase: "uploading", file, progress: 0 });
        const outcome = await uploadFile(id, docType, file, (progress) => setSlot(docType, { phase: "uploading", file, progress }));
        setSlot(docType, outcome.ok ? { phase: "uploaded", file } : { phase: "failed", file, error: outcome.message });
        return outcome.ok;
      }),
    );
    setBusy(false);
    if (results.every(Boolean)) router.push(`/shipments/${id}`);
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked && !busy) void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Party label="Importer" options={importers} value={importerId} onChange={setImporterId} locked={shipmentId !== null} />
        <Party label="Supplier" options={suppliers} value={supplierId} onChange={setSupplierId} locked={shipmentId !== null} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {SLOTS.map(({ docType, label, hint }) => (
          <UploadSlot key={docType} label={label} hint={hint} state={slots[docType]} onChange={(next) => setSlot(docType, next)} disabled={busy || slots[docType].phase === "uploaded"} />
        ))}
      </div>

      {formError && (
        <p role="alert" className="text-sm">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled button gets no pointer events; the wrapper keeps the tooltip reachable. */}
            <span tabIndex={blocked ? 0 : -1}>
              <Button type="submit" disabled={Boolean(blocked) || busy}>
                {busy ? "Uploading…" : shipmentId ? "Retry upload" : "Create shipment and upload"}
                <ArrowRight aria-hidden />
              </Button>
            </span>
          </TooltipTrigger>
          {blocked && <TooltipContent>{blocked}</TooltipContent>}
        </Tooltip>
        {shipmentId && uploadedAny && !busy && (
          <Button type="button" variant="outline" onClick={() => router.push(`/shipments/${shipmentId}`)}>
            Continue without the failed file
          </Button>
        )}
        <p className="text-sm text-muted-foreground">Missing documents can be added later from the review screen.</p>
      </div>
    </form>
  );
}

function Party({ label, options, value, onChange, locked }: { label: string; options: Option[]; value: string; onChange: (v: string) => void; locked: boolean }) {
  const id = `party-${label.toLowerCase()}`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={locked}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={`Choose the ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
