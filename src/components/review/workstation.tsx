"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { ReviewModel } from "@/server/queries/review-model";
import { DocumentViewer, SLOTS, ZOOMS, type ViewState } from "./document-viewer";
import { ExtractionProgress } from "./extraction-progress";
import { FieldPanel } from "./field-panel";
import { IssuesPanel, sortIssues } from "./issues-panel";

export type Focus = { kind: "field"; fieldId: string } | { kind: "check"; checkId: string; sourceFieldId: string | null } | null;
type MobileTab = "document" | "fields" | "issues";

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/**
 * S4 (ARCHITECTURE §11): owns the selection. ≥ 1024 px two panes (document 55% / panel 45%); below that, tabs
 * Document · Fields · Issues.
 */
export function Workstation({ model }: { model: ReviewModel }) {
  const firstDoc = SLOTS.find((d) => model.shipment.documents.some((x) => x.docType === d)) ?? "INVOICE";
  const [view, setView] = useState<ViewState>({ docType: firstDoc, pageNo: 1, zoom: 1, rotation: 0, fine: 0 });
  const [focus, setFocus] = useState<Focus>(null);
  const [tab, setTab] = useState<MobileTab>("issues");
  const onView = (next: Partial<ViewState>) => setView((v) => ({ ...v, ...next }));
  const fieldById = (id: string | null | undefined) => (id ? model.fields.find((f) => f.id === id) : undefined);

  /** Select a field or a check; the viewer jumps to the source (for a check, the first value that disagrees with the first). */
  const select = (next: { fieldId: string } | { checkId: string } | null) => {
    if (!next) return setFocus(null);
    if ("fieldId" in next) {
      setFocus({ kind: "field", fieldId: next.fieldId });
      const f = fieldById(next.fieldId);
      if (f?.pageNo) onView({ docType: f.docType, pageNo: f.pageNo });
      if (f?.pageNo && window.matchMedia("(max-width: 1023px)").matches) setTab("document");
      return;
    }
    const check = model.checks.find((c) => c.id === next.checkId);
    const observed = check?.observed ?? [];
    const located = (o: (typeof observed)[number]) => fieldById(o.fieldId)?.pageNo !== undefined && fieldById(o.fieldId)?.pageNo !== null;
    const pick = observed.find((o, i) => i > 0 && o.value !== observed[0]?.value && located(o)) ?? observed.find(located);
    const source = fieldById(pick?.fieldId);
    setFocus({ kind: "check", checkId: next.checkId, sourceFieldId: source?.id ?? null });
    if (source?.pageNo) onView({ docType: source.docType, pageNo: source.pageNo });
  };
  const source = fieldById(focus?.kind === "field" ? focus.fieldId : focus?.sourceFieldId);
  const highlight = source?.bbox && source.docType === view.docType && source.pageNo === view.pageNo ? source.bbox : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const zoomStep = (dir: 1 | -1) => {
        const i = ZOOMS.indexOf(view.zoom as (typeof ZOOMS)[number]);
        onView({ zoom: ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))] });
      };
      // J/K: next/previous item needing review, in the issues panel's order.
      const step = (dir: 1 | -1) => {
        type Target = { fieldId: string } | { checkId: string };
        const targets = sortIssues(model.issues).flatMap((i): Target[] => (i.fieldId ? [{ fieldId: i.fieldId }] : i.checkId ? [{ checkId: i.checkId }] : []));
        if (targets.length === 0) return;
        const at = targets.findIndex((t) => ("fieldId" in t ? focus?.kind === "field" && focus.fieldId === t.fieldId : focus?.kind === "check" && focus.checkId === t.checkId));
        const next = targets[(at + dir + targets.length) % targets.length] ?? targets[0];
        if (next) select(next);
      };
      const actions: Record<string, () => void> = {
        "1": () => onView({ docType: "INVOICE", pageNo: 1 }),
        "2": () => onView({ docType: "PACKING_LIST", pageNo: 1 }),
        "3": () => onView({ docType: "BILL_OF_LADING", pageNo: 1 }),
        "+": () => zoomStep(1),
        "=": () => zoomStep(1),
        "-": () => zoomStep(-1),
        r: () => onView({ rotation: view.rotation + 90 }),
        "[": () => onView({ fine: Math.max(-10, view.fine - 0.5) }),
        "]": () => onView({ fine: Math.min(10, view.fine + 0.5) }),
        Escape: () => setFocus(null),
        j: () => step(1),
        k: () => step(-1),
      };
      const run = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (run) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const tabs: Array<{ id: MobileTab; label: string; count?: number }> = [
    { id: "document", label: "Document" },
    { id: "fields", label: "Fields" },
    { id: "issues", label: "Issues", count: model.issues.length },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Review sections" className="flex border-b lg:hidden">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("flex-1 border-b-2 px-3 py-2.5 text-sm font-medium outline-none focus-visible:bg-muted", tab === t.id ? "border-foreground" : "border-transparent text-muted-foreground")}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 tabular-nums text-muted-foreground">{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[55fr_45fr]">
        <div className={cn("min-h-[70vh] border-r lg:min-h-0", tab !== "document" && "max-lg:hidden")}>
          <DocumentViewer view={view} onView={onView} documents={model.shipment.documents} pages={model.pages} highlight={highlight} highlightLabel={source?.label} />
        </div>
        <div className="min-h-0 overflow-y-auto">
          <ExtractionProgress shipment={model.shipment} />
          <div className={cn(tab !== "issues" && "max-lg:hidden")}>
            <IssuesPanel model={model} focus={focus} select={select} />
          </div>
          <div className={cn("border-t", tab !== "fields" && "max-lg:hidden")}>
            <FieldPanel model={model} focus={focus} select={select} />
          </div>
        </div>
      </div>
    </div>
  );
}
