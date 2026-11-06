import type { Metadata } from "next";
import { ApprovalSummary } from "@/components/approval/approval-summary";
import { getApprovalSummary } from "@/server/queries/approval";
import { getReviewModel } from "@/server/queries/review-model";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Approval · Customs cross-check" };

// S5: managers decide here; executives see the same summary read-only.
export default async function ApprovalPage(props: PageProps<"/shipments/[id]/approval">) {
  const user = await requireUser();
  const { id } = await props.params;
  const [model, summary] = await Promise.all([getReviewModel(id, user), getApprovalSummary(id)]);
  return (
    <main>
      <ApprovalSummary model={model} summary={summary} />
    </main>
  );
}
