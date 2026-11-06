import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main aria-busy className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <span className="sr-only">Loading shipment…</span>
      <div className="flex items-center gap-4 border-b px-4 py-3">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="grid flex-1 lg:grid-cols-[55fr_45fr]">
        <div className="flex flex-col gap-3 border-r p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mx-auto aspect-[1/1.41] w-full max-w-xl" />
        </div>
        <div className="hidden flex-col gap-3 p-4 lg:flex">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
    </main>
  );
}
