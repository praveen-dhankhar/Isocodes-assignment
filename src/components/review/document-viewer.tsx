"use client";

import { FileX2, Minus, Plus, RotateCcw, RotateCw, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DOC_LABEL, type DocType } from "@/domain/fields";
import { cn } from "@/lib/cn";
import type { DocumentDTO } from "@/server/queries/shipments";
import type { PageDTO } from "@/server/queries/review-model";
import { MarkUnreadableButton, ReplaceFileButton, SlotUpload } from "./document-actions";
import { SHORT } from "./labels";

export const SLOTS: DocType[] = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"];
export const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 3] as const;
const MAX_ZOOM = 3;

export interface ViewState {
  docType: DocType;
  pageNo: number;
  zoom: number;
  rotation: number; // quarter turns × 90
  fine: number; // ± degrees, for skewed scans
}

interface Props {
  view: ViewState;
  onView: (next: Partial<ViewState>) => void;
  documents: DocumentDTO[];
  pages: Record<DocType, PageDTO[]>;
  highlight: { x: number; y: number; w: number; h: number } | null;
  highlightLabel?: string;
  shipmentId: string;
  version: number;
  readOnly: boolean;
}

const IconButton = ({ label, keys, onClick, disabled, children }: { label: string; keys: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label={label} aria-keyshortcuts={keys} onClick={onClick} disabled={disabled}>
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>
      {label} <kbd className="ml-1 font-mono">{keys}</kbd>
    </TooltipContent>
  </Tooltip>
);

/** S4 left pane (ARCHITECTURE §11): document tabs, pages, zoom, rotation and the source box of the focused value. */
export function DocumentViewer({ view, onView, documents, pages, highlight, highlightLabel, shipmentId, version, readOnly }: Props) {
  const doc = documents.find((d) => d.docType === view.docType);
  const docPages = pages[view.docType];
  const page = docPages.find((p) => p.pageNo === view.pageNo) ?? docPages[0];
  const quarter = ((view.rotation % 360) + 360) % 360;
  const sideways = quarter === 90 || quarter === 270;
  // Turned sideways, the page is narrowed by its aspect ratio so its visual width still fits the pane.
  const width = page ? (view.zoom * 100) / (sideways ? page.height / page.width : 1) : 100;

  return (
    <section aria-label="Document viewer" className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div role="tablist" aria-label="Documents" className="flex rounded-lg bg-muted p-0.5">
          {SLOTS.map((d, i) => {
            const present = documents.some((x) => x.docType === d);
            return (
              <button
                key={d}
                role="tab"
                aria-selected={view.docType === d}
                aria-keyshortcuts={String(i + 1)}
                title={`${DOC_LABEL[d]} (${i + 1})`}
                onClick={() => onView({ docType: d, pageNo: 1 })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  view.docType === d ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                  !present && "line-through decoration-muted-foreground/50",
                )}
              >
                {SHORT[d]}
              </button>
            );
          })}
        </div>
        {docPages.length > 1 && (
          <div role="group" aria-label="Pages" className="flex items-center gap-1">
            {docPages.map((p) => (
              <Button key={p.pageNo} variant={p.pageNo === page?.pageNo ? "secondary" : "ghost"} size="xs" aria-current={p.pageNo === page?.pageNo ? "page" : undefined} onClick={() => onView({ pageNo: p.pageNo })}>
                p{p.pageNo}
                {p.readable === false && <TriangleAlert aria-label="unreadable" className="text-muted-foreground" />}
              </Button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="Zoom out" keys="−" onClick={() => onView({ zoom: ZOOMS[Math.max(0, ZOOMS.indexOf(view.zoom as (typeof ZOOMS)[number]) - 1)] })} disabled={view.zoom <= ZOOMS[0]}>
            <Minus aria-hidden />
          </IconButton>
          <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">{Math.round(view.zoom * 100)}%</span>
          <IconButton label="Zoom in" keys="+" onClick={() => onView({ zoom: ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(view.zoom as (typeof ZOOMS)[number]) + 1)] })} disabled={view.zoom >= MAX_ZOOM}>
            <Plus aria-hidden />
          </IconButton>
          <IconButton label="Rotate 90°" keys="R" onClick={() => onView({ rotation: view.rotation + 90 })}>
            <RotateCw aria-hidden />
          </IconButton>
          <IconButton label="Straighten −0.5°" keys="[" onClick={() => onView({ fine: Math.max(-10, view.fine - 0.5) })}>
            <RotateCcw aria-hidden className="size-3.5" />
          </IconButton>
          <span className="w-10 text-center text-xs tabular-nums text-muted-foreground" title="Fine rotation">
            {view.fine === 0 ? "0°" : `${view.fine > 0 ? "+" : ""}${view.fine.toFixed(1)}°`}
          </span>
          <IconButton label="Straighten +0.5°" keys="]" onClick={() => onView({ fine: Math.min(10, view.fine + 0.5) })}>
            <RotateCw aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      </div>

      {doc && (
        <div className="flex flex-wrap items-center gap-1 border-b px-3 py-1 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate" title={doc.originalFilename}>
            {doc.originalFilename}
            {page?.readable === false && " · this page is marked unreadable"}
          </span>
          {page && (
            <MarkUnreadableButton
              documentId={doc.id}
              pageNo={page.pageNo}
              version={version}
              reason={readOnly ? "Exported shipments are read-only until reopened" : page.readable === false ? "Already marked unreadable" : doc.status !== "EXTRACTED" && doc.status !== "MANUAL" ? "The document has not been read yet" : null}
            />
          )}
          <ReplaceFileButton shipmentId={shipmentId} docType={view.docType} readOnly={readOnly} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
        {!doc ? (
          <Empty title={`No ${DOC_LABEL[view.docType].toLowerCase()} uploaded`} body="Its fields and the checks that need it stay open until it is added.">
            {!readOnly && <SlotUpload shipmentId={shipmentId} docType={view.docType} />}
          </Empty>
        ) : !page ? (
          <Empty title="Pages are not ready" body={doc.status === "FAILED" ? "The file was stored but could not be rendered." : "Pages appear here once the file has been processed."} />
        ) : (
          <div className="relative mx-auto transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: `${width}%` }}>
            <div className="relative origin-center bg-background shadow-sm ring-1 ring-border transition-transform duration-200 ease-out motion-reduce:transition-none" style={{ transform: `rotate(${view.rotation + view.fine}deg)` }}>
              <Image src={page.url} alt={`${DOC_LABEL[view.docType]}, page ${page.pageNo}`} width={page.width} height={page.height} unoptimized priority className="block h-auto w-full select-none" draggable={false} />
              {highlight && (
                <div
                  aria-label={highlightLabel ? `Source of ${highlightLabel}` : "Source of the selected value"}
                  role="img"
                  data-testid="source-box"
                  className="pointer-events-none absolute rounded-[3px] outline-2 outline-offset-2 outline-foreground animate-in fade-in-0 duration-200"
                  style={{ left: `${highlight.x * 100}%`, top: `${highlight.y * 100}%`, width: `${highlight.w * 100}%`, height: `${highlight.h * 100}%`, boxShadow: "0 0 0 9999px color-mix(in oklch, var(--foreground) 22%, transparent)" }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 py-16 text-center">
      <FileX2 aria-hidden className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground text-pretty">{body}</p>
      {children}
    </div>
  );
}
