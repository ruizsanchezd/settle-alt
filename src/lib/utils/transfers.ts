export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/**
 * Calculate optimized debt settlement transfers using greedy algorithm
 * Minimizes the number of transactions needed to settle all debts
 * @param balances Map of member ID to balance (positive = owed, negative = owes)
 * @returns Array of transfers needed to settle all debts
 */
export function calculateOptimizedTransfers(
  balances: Record<string, number>
): Transfer[] {
  // Separate into debtors (negative balance = they owe) and creditors (positive = they are owed)
  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];

  Object.entries(balances).forEach(([memberId, balance]) => {
    if (balance < -0.005) {
      debtors.push({ id: memberId, amount: Math.abs(balance) });
    } else if (balance > 0.005) {
      creditors.push({ id: memberId, amount: balance });
    }
  });

  // Sort: largest first
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];

    const transferAmount =
      Math.round(Math.min(debtor.amount, creditor.amount) * 100) / 100;

    if (transferAmount > 0.005) {
      transfers.push({
        from: debtor.id,
        to: creditor.id,
        amount: transferAmount,
      });
    }

    debtor.amount = Math.round((debtor.amount - transferAmount) * 100) / 100;
    creditor.amount =
      Math.round((creditor.amount - transferAmount) * 100) / 100;

    if (debtor.amount < 0.005) i++;
    if (creditor.amount < 0.005) j++;
  }

  return transfers;
}
