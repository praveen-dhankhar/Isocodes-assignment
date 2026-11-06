import { Skeleton } from "@/components/ui/skeleton";

// Inside the shipment layout: the header is already there, only the screen body loads.
export default function Loading() {
  return (
    <main aria-busy className="grid flex-1 lg:grid-cols-[55fr_45fr]">
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-3 border-r p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mx-auto aspect-[1/1.41] w-full max-w-xl" />
      </div>
      <div className="hidden flex-col gap-3 p-4 lg:flex">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    </main>
  );
}
