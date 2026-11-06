"use client";

import { Eye } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { revealImporterContact } from "@/server/actions/importers";

type Contact = { contactName: string | null; contactEmail: string | null; contactPhone: string | null };

/** Masked by default; Reveal is logged (PII_REVEALED) and the details live only while this is on screen. */
export function ImporterContact({ importerId, shipmentId, masked }: { importerId: string; shipmentId: string; masked: string }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (contact) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md bg-muted/60 p-2 text-sm">
        <dt className="text-muted-foreground">Contact</dt>
        <dd>{contact.contactName ?? "—"}</dd>
        <dt className="text-muted-foreground">Email</dt>
        <dd className="font-mono">{contact.contactEmail ?? "—"}</dd>
        <dt className="text-muted-foreground">Phone</dt>
        <dd className="font-mono tabular-nums">{contact.contactPhone ?? "—"}</dd>
      </dl>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Importer contact</span>
      <span className="font-mono">{masked || "not on file"}</span>
      {masked && (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const r = await revealImporterContact({ importerId, shipmentId });
            setPending(false);
            if (r.ok) setContact(r.data);
            else setError(r.error.message);
          }}
        >
          <Eye aria-hidden /> Reveal
        </Button>
      )}
      <span className="text-xs text-muted-foreground">Revealing is logged.</span>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
