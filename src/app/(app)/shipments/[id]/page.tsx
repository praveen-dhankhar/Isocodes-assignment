import type { Metadata } from "next";
import { Workstation } from "@/components/review/workstation";
import { getReviewModel } from "@/server/queries/review-model";
import { markFirstOpened } from "@/server/services/shipments";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Review · Customs cross-check" };

// S4. The layout has already checked the id and that the shipment exists.
export default async function ReviewPage(props: PageProps<"/shipments/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const model = await getReviewModel(id, user);
  await markFirstOpened(id);
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <Workstation model={model} />
    </main>
  );
}
