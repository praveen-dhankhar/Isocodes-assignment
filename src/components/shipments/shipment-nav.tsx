"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/** Review · Approval · Export · History for one shipment (S4, S5, S6, S8). */
export function ShipmentNav({ shipmentId }: { shipmentId: string }) {
  const pathname = usePathname();
  const base = `/shipments/${shipmentId}`;
  const tabs = [
    { href: base, label: "Review" },
    { href: `${base}/approval`, label: "Approval" },
    { href: `${base}/export`, label: "Export" },
    { href: `${base}/history`, label: "History" },
  ];
  return (
    <nav aria-label="Shipment" className="flex gap-1 text-sm">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("rounded-md px-2.5 py-1 font-medium outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50", active ? "bg-muted" : "text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
