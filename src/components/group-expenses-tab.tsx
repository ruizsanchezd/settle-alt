"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Receipt, AlertTriangle } from "lucide-react";
import { type ExpenseWithSplits } from "@/lib/actions/expenses";
import {
  formatCurrency,
  formatDate,
  getInitials,
  getAvatarColor,
} from "@/lib/utils/format";
import { ExpenseFormSheet } from "@/components/expense-form-sheet";
import { ExpenseDetailSheet } from "@/components/expense-detail-sheet";
import type { Group, Member } from "@/lib/types";

export function GroupExpensesTab({
  group,
  members,
  currentMember,
  initialExpenses,
}: {
  group: Group;
  members: Member[];
  currentMember: Member;
  initialExpenses: ExpenseWithSplits[];
}) {
  const router = useRouter();
  const [expenses] = useState<ExpenseWithSplits[]>(initialExpenses);
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] =
    useState<ExpenseWithSplits | null>(null);
  const [editingExpense, setEditingExpense] =
    useState<ExpenseWithSplits | null>(null);

  const isArchived = group.status === "archived";
  const isSettling = group.status === "settling";

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
      // Refresh server component to reload all data
      router.refresh();
    }
  };

  const handleDetailClose = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      setSelectedExpense(null);
      // Refresh in case of delete
      router.refresh();
    }
  };

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
      className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50 active:bg-muted/50"
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
