"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { STATUS } from "./status-badge";

const ALL = "all";

/** S2 filters live in the URL (shareable, back-button safe). Search waits for a pause in typing. */
export function ShipmentFilters({ suppliers }: { suppliers: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const apply = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== ALL) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, { scroll: false }));
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const active = params.has("status") || params.has("supplier") || params.has("q");
  return (
    <div role="search" aria-busy={pending} className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-70")}>
      <div className="relative w-full sm:w-64">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search by ref or invoice number"
          placeholder="Ref or invoice no."
          className="pl-8"
          value={q}
          maxLength={50}
          onChange={(e) => {
            const value = e.target.value;
            setQ(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => apply("q", value.trim()), 300);
          }}
        />
      </div>
      <Select value={params.get("status") ?? ALL} onValueChange={(v) => apply("status", v)}>
        <SelectTrigger aria-label="Status" className="min-w-0 flex-1 sm:w-44 sm:flex-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {Object.entries(STATUS).map(([value, { label }]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("supplier") ?? ALL} onValueChange={(v) => apply("supplier", v)}>
        <SelectTrigger aria-label="Supplier" className="min-w-0 flex-1 sm:w-44 sm:flex-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All suppliers</SelectItem>
          {suppliers.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <X aria-hidden /> Clear
        </Button>
      )}
    </div>
  );
}
