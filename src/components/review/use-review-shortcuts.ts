"use client";

import { useEffect, useRef } from "react";

export interface ShortcutHandlers {
  next: () => void; // J
  previous: () => void; // K
  confirm: () => void; // Enter
  edit: () => void; // E
  cancel: () => void; // Esc
  tab: (n: 1 | 2 | 3) => void; // 1 / 2 / 3
  zoom: (dir: 1 | -1) => void; // + / −
  rotate: () => void; // R
  fine: (dir: 1 | -1) => void; // [ / ]
  help: () => void; // ?
  submit: () => void; // Ctrl/⌘ + Enter
}

/** The sheet the `?` key opens (ARCHITECTURE §11). */
export const SHORTCUTS: Array<[keys: string, what: string]> = [
  ["J / K", "Next / previous item needing review"],
  ["Enter", "Confirm the selected value"],
  ["E", "Correct or enter the selected value"],
  ["Esc", "Cancel editing, clear the selection"],
  ["1 / 2 / 3", "Invoice / packing list / bill of lading"],
  ["+ / −", "Zoom in / out"],
  ["R", "Rotate 90°"],
  ["[ / ]", "Straighten −0.5° / +0.5°"],
  ["Ctrl/⌘ + Enter", "Submit for approval"],
  ["?", "Show this list"],
];

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Global review keys. Off while typing in a field or when a dialog is open (it owns the keyboard then). */
export function useReviewShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = ref.current;
      if (e.defaultPrevented || document.querySelector("[role=dialog]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        return h.submit();
      }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      // Buttons and links keep their own Enter; elsewhere Enter confirms.
      if (e.key === "Enter" && e.target instanceof HTMLElement && ["BUTTON", "A"].includes(e.target.tagName)) return;
      const map: Record<string, () => void> = {
        j: h.next, k: h.previous, Enter: h.confirm, e: h.edit, Escape: h.cancel,
        "1": () => h.tab(1), "2": () => h.tab(2), "3": () => h.tab(3),
        "+": () => h.zoom(1), "=": () => h.zoom(1), "-": () => h.zoom(-1), r: h.rotate,
        "[": () => h.fine(-1), "]": () => h.fine(1), "?": h.help,
      };
      const run = map[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (run) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
