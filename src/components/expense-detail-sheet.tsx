"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Pencil, Trash2, User, Calendar, SplitSquareVertical, AlertTriangle } from "lucide-react";
import { deleteExpense, type ExpenseWithSplits } from "@/lib/actions/expenses";
import {
  formatCurrency,
  formatDate,
  getInitials,
  getAvatarColor,
} from "@/lib/utils/format";
import { toast } from "sonner";
import type { Member, SplitType } from "@/lib/types";

const SPLIT_TYPE_LABELS: Record<SplitType, string> = {
  equal: "A partes iguales",
  exact: "Cantidades exactas",
  percentage: "Por porcentaje",
  shares: "Por partes",
};

interface ExpenseDetailSheetProps {
  expense: ExpenseWithSplits | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: Member[];
  isArchived: boolean;
  isSettling?: boolean;
  onEdit: () => void;
}

export function ExpenseDetailSheet({
  expense,
  open,
  onOpenChange,
  members,
  isArchived,
  isSettling,
  onEdit,
}: ExpenseDetailSheetProps) {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!expense) return null;

  const memberMap = new Map(members.map((m) => [m.id, m]));

  const handleDelete = async () => {
    setDeleting(true);
    const result = await deleteExpense(expense.id, expense.group_id);

    if (result.error) {
      toast.error(result.error);
      setDeleting(false);
      return;
    }

    toast.success("Gasto eliminado");
    setDeleteDialogOpen(false);
    onOpenChange(false);
    setDeleting(false);
    router.refresh();
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl px-4"
        >
          <SheetHeader>
            <SheetTitle className="text-left">
              {expense.description}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-5 pb-6">
            {/* Amount */}
            <div className="text-center">
              <p className="text-3xl font-bold">
                {formatCurrency(expense.amount)}
              </p>
            </div>

            {/* Info rows */}
            <div className="space-y-1">
              <InfoRow
                icon={<User className="h-4 w-4" />}
                label="Pagado por"
                value={expense.paid_by_member.display_name}
              />
              <InfoRow
                icon={<SplitSquareVertical className="h-4 w-4" />}
                label="División"
                value={SPLIT_TYPE_LABELS[expense.split_type]}
              />
              <InfoRow
                icon={<Calendar className="h-4 w-4" />}
                label="Fecha"
                value={formatDate(expense.created_at)}
              />
            </div>

            <Separator />

            {/* Splits breakdown */}
            <div>
              <h4 className="mb-3 text-sm font-semibold">Reparto</h4>
              <div className="space-y-2">
                {expense.splits.map((split) => {
                  const member = memberMap.get(split.member_id);
                  const name = member?.display_name || "Desconocido";
                  const colors = getAvatarColor(name);

                  return (
                    <div
                      key={split.id}
                      className="flex items-center gap-3 rounded-xl border p-3"
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarFallback
                          className={`text-[10px] font-medium ${colors}`}
                        >
                          {getInitials(name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex-1 text-sm font-medium">
                        {name}
                      </span>
                      <span className="text-sm font-semibold">
                        {formatCurrency(split.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            {!isArchived && (
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false);
                    setTimeout(onEdit, 200);
                  }}
                  className="h-11 flex-1 gap-2 rounded-xl text-sm"
                >
                  <Pencil className="h-4 w-4" />
                  Editar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(true)}
                  className="h-11 flex-1 gap-2 rounded-xl text-sm text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar gasto</DialogTitle>
            <DialogDescription>
              ¿Seguro que quieres eliminar &ldquo;{expense.description}&rdquo;?
              Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {isSettling && (
            <div className="flex items-start gap-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
              <p className="text-xs text-yellow-800">
                El grupo está en liquidación. Eliminar este gasto recalculará
                las transferencias pendientes.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-xl"
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
