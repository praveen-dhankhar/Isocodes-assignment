import type { Metadata } from "next";
import { ExportPreview } from "@/components/export/export-preview";
import { previewExport } from "@/server/services/export";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Export · Customs cross-check" };

// S6. The preview is computed exactly as the export would be; the gate itself runs again on POST.
export default async function ExportPage(props: PageProps<"/shipments/[id]/export">) {
  await requireUser();
  const { id } = await props.params;
  const preview = await previewExport(id);
  return (
    <main>
      <ExportPreview shipmentId={id} {...preview} />
    </main>
  );
}
