// Display helpers for timestamps: Indian time, en-IN, compact (the desk is in Nhava Sheva).
const DATE_TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export const formatDateTime = (iso: string) => DATE_TIME.format(new Date(iso));
