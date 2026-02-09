"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Expense, ExpenseSplit, SplitType } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────

export interface ExpenseFormData {
  groupId: string;
  paidBy: string;
  description: string;
  amount: number;
  splitType: SplitType;
  /** member IDs participating in this expense */
  participants: string[];
  /** For exact: { memberId: amount }. For percentage: { memberId: percentage }. For shares: { memberId: shares } */
  splitValues?: Record<string, number>;
}

export interface ExpenseWithSplits extends Expense {
  splits: ExpenseSplit[];
  paid_by_member: { id: string; display_name: string };
  created_by_member: { id: string; display_name: string };
}

// ─── Split calculation ───────────────────────────────────

function calculateSplits(
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

// ─── Actions ─────────────────────────────────────────────

export async function createExpense(
  data: ExpenseFormData
): Promise<{ expense?: Expense; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  // Validate inputs
  if (!data.description.trim()) return { error: "La descripción es obligatoria" };
  if (data.amount <= 0) return { error: "El importe debe ser mayor a 0" };
  if (data.participants.length === 0) return { error: "Debe haber al menos un participante" };

  // Get current user's member record
  const { data: currentMember } = await supabase
    .from("members")
    .select("id")
    .eq("group_id", data.groupId)
    .eq("user_id", user.id)
    .single();

  if (!currentMember) return { error: "No eres miembro de este grupo" };

  // Validate paidBy and participants are members of this group
  const { data: groupMembers } = await supabase
    .from("members")
    .select("id")
    .eq("group_id", data.groupId);

  const memberIds = new Set(groupMembers?.map((m) => m.id) || []);

  if (!memberIds.has(data.paidBy)) {
    return { error: "El pagador no es miembro de este grupo" };
  }
  for (const pid of data.participants) {
    if (!memberIds.has(pid)) {
      return { error: "Un participante no es miembro de este grupo" };
    }
  }

  // Calculate splits
  let splits;
  try {
    splits = calculateSplits(
      data.amount,
      data.splitType,
      data.participants,
      data.splitValues
    );
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Create expense
  const { data: expense, error: expError } = await supabase
    .from("expenses")
    .insert({
      group_id: data.groupId,
      paid_by: data.paidBy,
      description: data.description.trim(),
      amount: data.amount,
      split_type: data.splitType,
      created_by: currentMember.id,
    })
    .select()
    .single();

  if (expError) return { error: expError.message };

  // Create splits — cleanup expense if this fails
  const { error: splitError } = await supabase.from("expense_splits").insert(
    splits.map((s) => ({
      expense_id: expense.id,
      member_id: s.memberId,
      amount: s.amount,
    }))
  );

  if (splitError) {
    // Cleanup: delete the expense we just created
    await supabase.from("expenses").delete().eq("id", expense.id);
    return { error: splitError.message };
  }

  revalidatePath(`/groups/${data.groupId}`);
  return { expense };
}

export async function getGroupExpenses(
  groupId: string
): Promise<ExpenseWithSplits[]> {
  const supabase = await createClient();

  const { data: expenses, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error || !expenses) return [];

  if (expenses.length === 0) return [];

  // Get all splits for these expenses
  const expenseIds = expenses.map((e) => e.id);
  const { data: allSplits } = await supabase
    .from("expense_splits")
    .select("*")
    .in("expense_id", expenseIds);

  // Get member names for paid_by and created_by
  const memberIds = new Set<string>();
  expenses.forEach((e) => {
    memberIds.add(e.paid_by);
    memberIds.add(e.created_by);
  });

  const { data: members } = await supabase
    .from("members")
    .select("id, display_name")
    .in("id", Array.from(memberIds));

  const memberMap = new Map(members?.map((m) => [m.id, m]) || []);

  return expenses.map((e) => ({
    ...e,
    splits: (allSplits || []).filter((s) => s.expense_id === e.id),
    paid_by_member: memberMap.get(e.paid_by) || {
      id: e.paid_by,
      display_name: "Desconocido",
    },
    created_by_member: memberMap.get(e.created_by) || {
      id: e.created_by,
      display_name: "Desconocido",
    },
  }));
}

export async function updateExpense(
  expenseId: string,
  data: ExpenseFormData
): Promise<{ expense?: Expense; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  if (!data.description.trim()) return { error: "La descripción es obligatoria" };
  if (data.amount <= 0) return { error: "El importe debe ser mayor a 0" };
  if (data.participants.length === 0) return { error: "Debe haber al menos un participante" };

  // Validate paidBy and participants are members of this group
  const { data: groupMembers } = await supabase
    .from("members")
    .select("id")
    .eq("group_id", data.groupId);

  const memberIds = new Set(groupMembers?.map((m) => m.id) || []);

  if (!memberIds.has(data.paidBy)) {
    return { error: "El pagador no es miembro de este grupo" };
  }
  for (const pid of data.participants) {
    if (!memberIds.has(pid)) {
      return { error: "Un participante no es miembro de este grupo" };
    }
  }

  // Calculate new splits
  let splits;
  try {
    splits = calculateSplits(
      data.amount,
      data.splitType,
      data.participants,
      data.splitValues
    );
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Update expense
  const { data: expense, error: expError } = await supabase
    .from("expenses")
    .update({
      paid_by: data.paidBy,
      description: data.description.trim(),
      amount: data.amount,
      split_type: data.splitType,
      updated_at: new Date().toISOString(),
    })
    .eq("id", expenseId)
    .select()
    .single();

  if (expError) return { error: expError.message };

  // Delete old splits and insert new ones
  const { error: delError } = await supabase
    .from("expense_splits")
    .delete()
    .eq("expense_id", expenseId);

  if (delError) return { error: delError.message };

  const { error: splitError } = await supabase.from("expense_splits").insert(
    splits.map((s) => ({
      expense_id: expenseId,
      member_id: s.memberId,
      amount: s.amount,
    }))
  );

  if (splitError) return { error: splitError.message };

  revalidatePath(`/groups/${data.groupId}`);
  return { expense };
}

export async function deleteExpense(
  expenseId: string,
  groupId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "No autenticado" };

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/groups/${groupId}`);
  return { success: true };
}
