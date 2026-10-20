/** Visningsstatus: en skickad faktura vars förfallodag passerat räknas som förfallen. */
export function displayStatus(inv: { status: string; dueDate: Date }, now = new Date()) {
  if (inv.status === "sent" && inv.dueDate < new Date(now.toISOString().slice(0, 10))) return "overdue";
  return inv.status;
}
