import type { Metadata } from "next";
import { connection } from "next/server";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in · Customs cross-check" };

// S1. Rendered per request so its scripts carry the CSP nonce; still no session lookup, so it renders even when the
// database is unreachable.
export default async function LoginPage() {
  await connection();
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">Customs document cross-check for Company A.</p>
        </header>
        <LoginForm />
        <p className="text-xs text-muted-foreground">Accounts are set up by your administrator; there is no self sign-up.</p>
      </div>
    </main>
  );
}
