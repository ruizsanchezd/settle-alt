"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Member, Settlement } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────

export interface MemberBalance {
  memberId: string;
  displayName: string;
  totalPaid: number;
  totalOwed: number;
  balance: number; // positive = they are owed, negative = they owe
}

export interface SuggestedTransfer {
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amount: number;
}

export interface BalancesData {
  balances: MemberBalance[];
  suggestedTransfers: SuggestedTransfer[];
  settlements: Settlement[];
  pendingTransfers: SuggestedTransfer[];
}

// ─── Balance calculation ─────────────────────────────────

export async function getGroupBalances(
  groupId: string,
  members: Member[]
): Promise<BalancesData> {
  const supabase = await createClient();

  // 1. Get all expenses for this group
  const { data: expenses } = await supabase
    .from("expenses")
    .select("id, paid_by, amount")
    .eq("group_id", groupId);

  // 2. Get all expense splits
  const expenseIds = (expenses || []).map((e) => e.id);
  const { data: splits } = expenseIds.length > 0
    ? await supabase
        .from("expense_splits")
        .select("member_id, amount, expense_id")
        .in("expense_id", expenseIds)
    : { data: [] };

  // 3. Get all settlements
  const { data: settlements } = await supabase
    .from("settlements")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  const memberMap = new Map(members.map((m) => [m.id, m]));

  // 4. Calculate raw balances: paid - owed
  const paidMap: Record<string, number> = {};
  const owedMap: Record<string, number> = {};

  (expenses || []).forEach((e) => {
    paidMap[e.paid_by] = (paidMap[e.paid_by] || 0) + Number(e.amount);
  });

  (splits || []).forEach((s) => {
    owedMap[s.member_id] = (owedMap[s.member_id] || 0) + Number(s.amount);
  });

  const balances: MemberBalance[] = members.map((m) => {
    const totalPaid = paidMap[m.id] || 0;
    const totalOwed = owedMap[m.id] || 0;
    return {
      memberId: m.id,
      displayName: m.display_name,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalOwed: Math.round(totalOwed * 100) / 100,
      balance: Math.round((totalPaid - totalOwed) * 100) / 100,
    };
  });

  // 5. Calculate adjusted balances (subtract settled settlements)
  const settledSettlements = (settlements || []).filter((s) => s.settled_at);
  const adjustedBalances = new Map<string, number>();
  balances.forEach((b) => adjustedBalances.set(b.memberId, b.balance));

  settledSettlements.forEach((s) => {
    const fromBal = adjustedBalances.get(s.from_member) || 0;
    const toBal = adjustedBalances.get(s.to_member) || 0;
    // A settled payment means from_member paid to_member, so:
    // from_member's balance improves (less negative), to_member's balance decreases (less positive)
    adjustedBalances.set(
      s.from_member,
      Math.round((fromBal + Number(s.amount)) * 100) / 100
    );
    adjustedBalances.set(
      s.to_member,
      Math.round((toBal - Number(s.amount)) * 100) / 100
    );
  });

  // 6. Run optimized transfer algorithm on adjusted balances
  const pendingTransfers = calculateOptimizedTransfers(
    adjustedBalances,
    memberMap
  );

  // 7. Also calculate suggested transfers from raw balances (for display when active)
  const rawBalanceMap = new Map<string, number>();
  balances.forEach((b) => rawBalanceMap.set(b.memberId, b.balance));
  const suggestedTransfers = calculateOptimizedTransfers(
    rawBalanceMap,
    memberMap
  );

  return {
    balances,
    suggestedTransfers,
    settlements: settlements || [],
    pendingTransfers,
  };
}

// ─── Greedy transfer optimization ────────────────────────

function calculateOptimizedTransfers(
  balanceMap: Map<string, number>,
  memberMap: Map<string, Member>
): SuggestedTransfer[] {
  // Separate into debtors (negative balance = they owe) and creditors (positive = they are owed)
  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];

  balanceMap.forEach((balance, memberId) => {
    if (balance < -0.005) {
      debtors.push({ id: memberId, amount: Math.abs(balance) });
    } else if (balance > 0.005) {
      creditors.push({ id: memberId, amount: balance });
    }
  });

  // Sort: largest first
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers: SuggestedTransfer[] = [];

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];

    const transferAmount =
      Math.round(Math.min(debtor.amount, creditor.amount) * 100) / 100;

    if (transferAmount > 0.005) {
      const fromMember = memberMap.get(debtor.id);
      const toMember = memberMap.get(creditor.id);

      transfers.push({
        fromMemberId: debtor.id,
        fromName: fromMember?.display_name || "Desconocido",
        toMemberId: creditor.id,
        toName: toMember?.display_name || "Desconocido",
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

// ─── Settlement actions ──────────────────────────────────

export async function markTransferAsSettled(
  groupId: string,
  fromMemberId: string,
  toMemberId: string,
  amount: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "No autenticado" };

  // Validate amount
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: "El importe debe ser un número positivo" };
  }
  if (amount > 999999.99) {
    return { success: false, error: "El importe es demasiado alto" };
  }

  // Validate different members
  if (fromMemberId === toMemberId) {
    return {
      success: false,
      error: "El pagador y el receptor deben ser diferentes",
    };
  }

  // Check group status — transition to settling if active
  const { data: group } = await supabase
    .from("groups")
    .select("status")
    .eq("id", groupId)
    .single();

  if (!group) return { success: false, error: "Grupo no encontrado" };
  if (group.status === "archived") {
    return { success: false, error: "El grupo está archivado" };
  }

  // If active, transition to settling
  if (group.status === "active") {
    const { error: updateError } = await supabase
      .from("groups")
      .update({
        status: "settling" as const,
        frozen_at: new Date().toISOString(),
      })
      .eq("id", groupId);

    if (updateError) return { success: false, error: updateError.message };
  }

  // Create the settlement record
  const { error } = await supabase.from("settlements").insert({
    group_id: groupId,
    from_member: fromMemberId,
    to_member: toMemberId,
    amount,
    settled_at: new Date().toISOString(),
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(`/groups/${groupId}`);
  return { success: true };
}

export async function getGroupSettlements(
  groupId: string
): Promise<Settlement[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return data || [];
}
