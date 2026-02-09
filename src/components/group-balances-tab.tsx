"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Scale,
  ArrowRight,
  Check,
  CircleCheck,
  AlertTriangle,
  History,
} from "lucide-react";
import {
  getGroupBalances,
  markTransferAsSettled,
  type BalancesData,
  type SuggestedTransfer,
} from "@/lib/actions/settlements";
import {
  formatCurrency,
  formatDate,
  getInitials,
  getAvatarColor,
} from "@/lib/utils/format";
import { toast } from "sonner";
import type { Group, Member } from "@/lib/types";

export function GroupBalancesTab({
  group,
  members,
}: {
  group: Group;
  members: Member[];
}) {
  const router = useRouter();
  const [data, setData] = useState<BalancesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [settlingTransfer, setSettlingTransfer] =
    useState<SuggestedTransfer | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [settling, setSettling] = useState(false);

  const isArchived = group.status === "archived";
  const isSettling = group.status === "settling";

  const loadData = useCallback(async () => {
    try {
      const result = await getGroupBalances(group.id, members);
      setData(result);
    } catch {
      toast.error("Error al cargar los balances");
    } finally {
      setLoading(false);
    }
  }, [group.id, members]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSettle = async () => {
    if (!settlingTransfer) return;
    setSettling(true);

    const result = await markTransferAsSettled(
      group.id,
      settlingTransfer.fromMemberId,
      settlingTransfer.toMemberId,
      settlingTransfer.amount
    );

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Transferencia marcada como saldada");
      setConfirmOpen(false);
      loadData();
      router.refresh();
    }

    setSettling(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!data) return null;

  const hasExpenses = data.balances.some(
    (b) => b.totalPaid > 0 || b.totalOwed > 0
  );

  if (!hasExpenses) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Scale className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Sin balances todavía
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Los balances aparecerán cuando haya gastos
        </p>
      </div>
    );
  }

  // Use pending transfers (adjusted for settled) when settling, raw suggested otherwise
  const transfers = isSettling
    ? data.pendingTransfers
    : data.suggestedTransfers;

  const settledSettlements = data.settlements.filter((s) => s.settled_at);
  const allSettled = transfers.length === 0 && settledSettlements.length > 0;

  return (
    <div className="space-y-6">
      {/* Settling banner */}
      {isSettling && (
        <div className="flex items-start gap-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
          <p className="text-xs text-yellow-800">
            El grupo está en proceso de liquidación. Si se añaden gastos, las
            transferencias se recalcularán.
          </p>
        </div>
      )}

      {/* All settled banner */}
      {allSettled && (
        <div className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          <p className="text-xs text-green-800">
            Todas las deudas están saldadas
          </p>
        </div>
      )}

      {/* Member balances */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Balances</h3>
        <div className="space-y-2">
          {data.balances
            .filter((b) => b.totalPaid > 0 || b.totalOwed > 0)
            .sort((a, b) => b.balance - a.balance)
            .map((b) => {
              const colors = getAvatarColor(b.displayName);
              const isPositive = b.balance > 0.005;
              const isNegative = b.balance < -0.005;

              return (
                <div
                  key={b.memberId}
                  className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarFallback
                      className={`text-xs font-medium ${colors}`}
                    >
                      {getInitials(b.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium">
                      {b.displayName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Pagó {formatCurrency(b.totalPaid)} · Debe{" "}
                      {formatCurrency(b.totalOwed)}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-bold ${
                      isPositive
                        ? "text-green-600"
                        : isNegative
                          ? "text-red-600"
                          : "text-muted-foreground"
                    }`}
                  >
                    {isPositive ? "+" : ""}
                    {formatCurrency(b.balance)}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      <Separator />

      {/* Suggested / pending transfers */}
      {transfers.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">
            {isSettling ? "Transferencias pendientes" : "Transferencias sugeridas"}
          </h3>
          <div className="space-y-2">
            {transfers.map((t, i) => (
              <TransferCard
                key={`${t.fromMemberId}-${t.toMemberId}-${i}`}
                transfer={t}
                isArchived={isArchived}
                onSettle={() => {
                  setSettlingTransfer(t);
                  setConfirmOpen(true);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Settlement history */}
      {settledSettlements.length > 0 && (
        <>
          <Separator />
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4" />
              Historial de liquidaciones
            </h3>
            <div className="space-y-2">
              {settledSettlements.map((s) => {
                const fromMember = members.find(
                  (m) => m.id === s.from_member
                );
                const toMember = members.find((m) => m.id === s.to_member);
                return (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 rounded-xl border border-green-100 bg-green-50/50 p-3"
                  >
                    <CircleCheck className="h-4 w-4 shrink-0 text-green-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">
                          {fromMember?.display_name || "Desconocido"}
                        </span>
                        {" "}pagó{" "}
                        <span className="font-bold">
                          {formatCurrency(Number(s.amount))}
                        </span>
                        {" "}a{" "}
                        <span className="font-medium">
                          {toMember?.display_name || "Desconocido"}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.settled_at ? formatDate(s.settled_at) : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Confirm settle dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar pago</DialogTitle>
            <DialogDescription>
              ¿Confirmas que{" "}
              <span className="font-medium text-foreground">
                {settlingTransfer?.fromName}
              </span>{" "}
              ha pagado{" "}
              <span className="font-bold text-foreground">
                {settlingTransfer ? formatCurrency(settlingTransfer.amount) : ""}
              </span>{" "}
              a{" "}
              <span className="font-medium text-foreground">
                {settlingTransfer?.toName}
              </span>
              ?
            </DialogDescription>
          </DialogHeader>
          {group.status === "active" && (
            <div className="flex items-start gap-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
              <p className="text-xs text-yellow-800">
                Al marcar la primera transferencia como saldada, el grupo
                pasará a modo liquidación.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              className="rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSettle}
              disabled={settling}
              className="rounded-xl"
            >
              {settling ? "Registrando..." : "Confirmar pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Transfer card ───────────────────────────────────────

function TransferCard({
  transfer,
  isArchived,
  onSettle,
}: {
  transfer: SuggestedTransfer;
  isArchived: boolean;
  onSettle: () => void;
}) {
  const fromColors = getAvatarColor(transfer.fromName);
  const toColors = getAvatarColor(transfer.toName);

  return (
    <div className="flex items-center gap-2 rounded-xl border p-3 transition-colors hover:bg-muted/50">
      {/* From */}
      <div className="flex items-center gap-2">
        <Avatar className="h-8 w-8">
          <AvatarFallback className={`text-[10px] font-medium ${fromColors}`}>
            {getInitials(transfer.fromName)}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium">{transfer.fromName}</span>
      </div>

      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />

      {/* To */}
      <div className="flex items-center gap-2">
        <Avatar className="h-8 w-8">
          <AvatarFallback className={`text-[10px] font-medium ${toColors}`}>
            {getInitials(transfer.toName)}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium">{transfer.toName}</span>
      </div>

      <div className="flex-1" />

      {/* Amount + action */}
      <div className="flex flex-col items-end gap-1">
        <span className="text-sm font-bold">
          {formatCurrency(transfer.amount)}
        </span>
        {!isArchived && (
          <Button
            variant="outline"
            size="sm"
            onClick={onSettle}
            className="h-7 gap-1 rounded-lg px-2 text-[11px]"
          >
            <Check className="h-3 w-3" />
            Saldar
          </Button>
        )}
      </div>
    </div>
  );
}
