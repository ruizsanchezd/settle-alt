"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Receipt, AlertTriangle } from "lucide-react";
import { getGroupExpenses, type ExpenseWithSplits } from "@/lib/actions/expenses";
import {
  formatCurrency,
  formatDate,
  getInitials,
  getAvatarColor,
} from "@/lib/utils/format";
import { toast } from "sonner";
import { ExpenseFormSheet } from "@/components/expense-form-sheet";
import { ExpenseDetailSheet } from "@/components/expense-detail-sheet";
import type { Group, Member } from "@/lib/types";

export function GroupExpensesTab({
  group,
  members,
  currentMember,
}: {
  group: Group;
  members: Member[];
  currentMember: Member;
}) {
  const [expenses, setExpenses] = useState<ExpenseWithSplits[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] =
    useState<ExpenseWithSplits | null>(null);
  const [editingExpense, setEditingExpense] =
    useState<ExpenseWithSplits | null>(null);

  const isArchived = group.status === "archived";
  const isSettling = group.status === "settling";

  const loadExpenses = useCallback(async () => {
    try {
      const data = await getGroupExpenses(group.id);
      setExpenses(data);
    } catch {
      toast.error("Error al cargar los gastos");
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const handleExpenseClick = (expense: ExpenseWithSplits) => {
    setSelectedExpense(expense);
    setDetailOpen(true);
  };

  const handleEdit = () => {
    setEditingExpense(selectedExpense);
    setFormOpen(true);
  };

  const handleFormClose = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setEditingExpense(null);
      // Reload expenses after create/edit
      loadExpenses();
    }
  };

  const handleDetailClose = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      setSelectedExpense(null);
      // Reload in case of delete
      loadExpenses();
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      {/* Settling warning */}
      {isSettling && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
          <p className="text-xs text-yellow-800">
            El grupo está en liquidación. Añadir o modificar gastos recalculará
            las transferencias pendientes.
          </p>
        </div>
      )}

      {/* Add expense button */}
      {!isArchived && (
        <Button
          onClick={() => {
            setEditingExpense(null);
            setFormOpen(true);
          }}
          className="mb-4 h-11 w-full gap-2 rounded-xl text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          Añadir gasto
        </Button>
      )}

      {/* Expenses list */}
      {expenses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Receipt className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Aún no hay gastos
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Añade el primer gasto del grupo
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {expenses.map((expense) => (
            <ExpenseCard
              key={expense.id}
              expense={expense}
              onClick={() => handleExpenseClick(expense)}
            />
          ))}
        </div>
      )}

      {/* Form sheet */}
      <ExpenseFormSheet
        open={formOpen}
        onOpenChange={handleFormClose}
        group={group}
        members={members}
        currentMember={currentMember}
        editingExpense={editingExpense}
      />

      {/* Detail sheet */}
      <ExpenseDetailSheet
        expense={selectedExpense}
        open={detailOpen}
        onOpenChange={handleDetailClose}
        members={members}
        isArchived={isArchived}
        isSettling={isSettling}
        onEdit={handleEdit}
      />
    </>
  );
}

function ExpenseCard({
  expense,
  onClick,
}: {
  expense: ExpenseWithSplits;
  onClick: () => void;
}) {
  const payerName = expense.paid_by_member.display_name;
  const colors = getAvatarColor(payerName);

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors active:bg-muted/50"
    >
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarFallback className={`text-xs font-medium ${colors}`}>
          {getInitials(payerName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold">
          {expense.description}
        </p>
        <p className="text-xs text-muted-foreground">
          Pagado por {payerName} · {formatDate(expense.created_at)}
        </p>
      </div>
      <span className="shrink-0 text-sm font-bold">
        {formatCurrency(expense.amount)}
      </span>
    </button>
  );
}
