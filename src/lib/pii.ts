// Importer contacts are personal data (DPDP Act 2023): shown masked; revealing them is a logged action (PII_REVEALED).

/** imports.p@example.test → im•••••••@example.test */
export function maskEmail(email: string | null): string {
  if (!email) return "";
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(3, local.length - 2))}@${domain}`;
}

/** +91 90000 00001 → +91 ••••• •••01 */
export function maskPhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return `${phone.startsWith("+") ? `+${digits.slice(0, 2)} ` : ""}••••• •••${digits.slice(-2)}`;
}
