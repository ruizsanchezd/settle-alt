import type { SplitType } from "@/lib/types";

/**
 * Calculate how an expense should be split among participants
 * @param amount Total amount to split
 * @param splitType Type of split (equal, exact, percentage, shares)
 * @param participants Array of member IDs
 * @param splitValues Optional values for exact/percentage/shares splits
 * @returns Array of splits with memberId and amount
 */
export function calculateSplits(
  amount: number,
  splitType: SplitType,
  participants: string[],
  splitValues?: Record<string, number>
): { memberId: string; amount: number }[] {
  if (participants.length === 0) {
    throw new Error("Debe haber al menos un participante");
  }

  switch (splitType) {
    case "equal": {
      const baseAmount = Math.floor((amount * 100) / participants.length) / 100;
      const remainder = Math.round((amount - baseAmount * participants.length) * 100);

      return participants.map((memberId, i) => ({
        memberId,
        amount: i < remainder
          ? Math.round((baseAmount + 0.01) * 100) / 100
          : baseAmount,
      }));
    }

    case "exact": {
      if (!splitValues) throw new Error("Valores de split requeridos");
      const sum = participants.reduce(
        (acc, id) => acc + (splitValues[id] || 0),
        0
      );
      if (Math.abs(sum - amount) > 0.01) {
        throw new Error(
          `La suma (${sum.toFixed(2)}) no coincide con el total (${amount.toFixed(2)})`
        );
      }
      return participants.map((memberId) => ({
        memberId,
        amount: Math.round((splitValues[memberId] || 0) * 100) / 100,
      }));
    }

    case "percentage": {
      if (!splitValues) throw new Error("Valores de split requeridos");
      const totalPct = participants.reduce(
        (acc, id) => acc + (splitValues[id] || 0),
        0
      );
      if (Math.abs(totalPct - 100) > 0.01) {
        throw new Error(
          `Los porcentajes suman ${totalPct.toFixed(1)}%, deben sumar 100%`
        );
      }

      const rawSplits = participants.map((memberId) => ({
        memberId,
        raw: (amount * (splitValues[memberId] || 0)) / 100,
      }));

      // Round and fix rounding errors
      const splits = rawSplits.map((s) => ({
        memberId: s.memberId,
        amount: Math.floor(s.raw * 100) / 100,
      }));

      const roundedSum = splits.reduce((acc, s) => acc + s.amount, 0);
      const diff = Math.round((amount - roundedSum) * 100);
      for (let i = 0; i < diff; i++) {
        splits[i].amount = Math.round((splits[i].amount + 0.01) * 100) / 100;
      }

      return splits;
    }

    case "shares": {
      if (!splitValues) throw new Error("Valores de split requeridos");
      const totalShares = participants.reduce(
        (acc, id) => acc + (splitValues[id] || 0),
        0
      );
      if (totalShares <= 0) {
        throw new Error("Las partes deben ser mayores a 0");
      }

      const rawSplits = participants.map((memberId) => ({
        memberId,
        raw: (amount * (splitValues[memberId] || 0)) / totalShares,
      }));

      const splits = rawSplits.map((s) => ({
        memberId: s.memberId,
        amount: Math.floor(s.raw * 100) / 100,
      }));

      const roundedSum = splits.reduce((acc, s) => acc + s.amount, 0);
      const diff = Math.round((amount - roundedSum) * 100);
      for (let i = 0; i < diff; i++) {
        splits[i].amount = Math.round((splits[i].amount + 0.01) * 100) / 100;
      }

      return splits;
    }

    default:
      throw new Error(`Tipo de split no válido: ${splitType}`);
  }
}
