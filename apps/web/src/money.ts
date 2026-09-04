/** Issue #3 (PRD area A): the only place paise become rupees for display. */
export function formatRupees(priceMinor: number): string {
  const rupees = priceMinor / 100;
  return `₹${Number.isInteger(rupees) ? rupees : rupees.toFixed(2)}`;
}
