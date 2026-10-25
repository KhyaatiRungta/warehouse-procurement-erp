const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const integer = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const money = (value: number): string => currency.format(value);
export const qty = (value: number): string => integer.format(value);
export const signed = (value: number): string => (value > 0 ? `+${integer.format(value)}` : integer.format(value));

export function dateOnly(value: string | null): string {
  if (!value) return "Not set";
  const [y, m, d] = value.split("-").map(Number);
  return dateFmt.format(new Date(y, m - 1, d));
}

export function dateTime(value: string | null): string {
  if (!value) return "Not set";
  return dateTimeFmt.format(new Date(value));
}

export function relativeDays(value: string): string {
  const diff = Math.round((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${Math.abs(diff)} days ago`;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Awaiting approval",
  approved: "Approved",
  sent: "Sent to supplier",
  partially_received: "Partly received",
  received: "Received",
  cancelled: "Cancelled",
  rejected: "Rejected",
  converted: "Converted to PO",
};

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  buyer: "Buyer",
  warehouse_clerk: "Warehouse clerk",
};

export const MOVEMENT_LABEL: Record<string, string> = {
  RECEIPT: "Receipt",
  ADJUSTMENT: "Adjustment",
  ISSUE: "Issue",
};
