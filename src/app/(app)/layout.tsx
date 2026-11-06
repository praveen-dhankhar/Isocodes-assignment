import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { UserMenu } from "@/components/auth/user-menu";
import { getUser } from "@/server/session";

const navLink = "rounded-sm text-muted-foreground transition-colors hover:text-foreground";

// Signed-in shell. proxy.ts only checks that a session cookie exists; this checks the session itself.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:gap-6">
          <Link href="/" className="rounded-sm font-semibold whitespace-nowrap">
            <span className="sm:hidden">Cross-check</span>
            <span className="hidden sm:inline">Customs cross-check</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-4 text-sm">
            <Link href="/shipments" className={navLink}>
              Shipments
            </Link>
            {user.role === "DOCUMENTATION_MANAGER" && (
              <Link href="/reports/accuracy" className={navLink}>
                Accuracy
              </Link>
            )}
          </nav>
          <div className="ml-auto">
            <UserMenu name={user.name} email={user.email} role={user.role} />
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
