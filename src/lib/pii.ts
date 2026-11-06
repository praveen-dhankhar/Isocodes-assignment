// Importer contacts are personal data (DPDP Act 2023): shown masked; reveal is a logged action (M10.2).

/** imports.p@example.test → im•••••••@example.test */
export function maskEmail(email: string | null): string {
  if (!email) return "";
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(3, local.length - 2))}@${domain}`;
}
