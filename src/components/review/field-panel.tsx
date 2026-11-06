"use client";

import { Bot, FileText, PencilLine } from "lucide-react";
import { DOC_LABEL, type DocType } from "@/domain/fields";
import type { FieldDTO, ReviewModel } from "@/server/queries/review-model";
import type { DocumentDTO } from "@/server/queries/shipments";
import { AddLineButton, RemoveLineButton } from "./document-actions";
import type { FieldActions } from "./field-actions";
import { FieldRow } from "./field-row";
import { MODE_LABEL } from "./labels";
import type { Focus } from "./workstation";

const SLOTS: DocType[] = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"];
const MODE_ICON = { LIVE: Bot, SAMPLE: FileText, MANUAL: PencilLine } as const;

/** Rule 8: where the values came from, always visible next to them. */
export function ModeBadge({ document }: { document: DocumentDTO }) {
  if (!document.mode) return null;
  const Icon = MODE_ICON[document.mode];
  return (
    <span title={document.modelId ? `Model: ${document.modelId}` : undefined} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border ring-inset">
      <Icon aria-hidden className="size-3" />
      {MODE_LABEL[document.mode]}
    </span>
  );
}

/** S4 fields, grouped by document: header values, then each line item. */
interface RowProps {
  focus: Focus;
  select: (f: { fieldId: string }) => void;
  editing: string | null;
  setEditing: (id: string | null) => void;
  actions: FieldActions;
  editable: boolean;
}

export function FieldPanel({ model, ...rowProps }: RowProps & { model: ReviewModel }) {
  const docs = SLOTS.flatMap((slot) => model.shipment.documents.filter((d) => d.docType === slot));
  if (docs.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No documents yet. Fields appear once a document has been read.</p>;
  }
  return (
    <div className="flex flex-col">
      {docs.map((doc) => {
        const fields = model.fields.filter((f) => f.documentId === doc.id);
        const header = fields.filter((f) => f.lineNo === null);
        const lines = [...new Set(fields.flatMap((f) => (f.lineNo === null ? [] : [f.lineNo])))].sort((a, b) => a - b);
        return (
          <section key={doc.id} aria-labelledby={`fields-${doc.docType}`} className="border-t p-4 first:border-t-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 id={`fields-${doc.docType}`} className="text-sm font-semibold">
                {DOC_LABEL[doc.docType]}
              </h2>
              <ModeBadge document={doc} />
              <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground" title={doc.originalFilename}>
                {doc.originalFilename}
              </span>
            </div>
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">{doc.status === "FAILED" ? "Not read: extraction failed." : "Not read yet."}</p>
            ) : (
              <>
                <Rows fields={header} {...rowProps} />
                {lines.map((n) => {
                  const cells = fields.filter((f) => f.lineNo === n);
                  return (
                    <div key={n} className="mt-3">
                      <h3 className="flex items-center justify-between px-2 pb-1 text-xs font-medium text-muted-foreground">
                        Line {n}
                        {rowProps.editable && cells.every((f) => f.originalAiValue === null) && <RemoveLineButton documentId={doc.id} lineNo={n} version={model.shipment.version} />}
                      </h3>
                      <Rows fields={cells} {...rowProps} />
                    </div>
                  );
                })}
                {rowProps.editable && doc.docType !== "BILL_OF_LADING" && (
                  <div className="mt-2">
                    <AddLineButton documentId={doc.id} version={model.shipment.version} />
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Rows({ fields, focus, select, editing, setEditing, actions, editable }: RowProps & { fields: FieldDTO[] }) {
  return (
    <div className="flex flex-col">
      {fields.map((f) => (
        <FieldRow
          key={f.id}
          field={f}
          selected={focus?.kind === "field" && focus.fieldId === f.id}
          onSelect={() => select({ fieldId: f.id })}
          editing={editing === f.id}
          onEdit={(on) => setEditing(on ? f.id : null)}
          actions={actions}
          editable={editable}
        />
      ))}
    </div>
  );
}
