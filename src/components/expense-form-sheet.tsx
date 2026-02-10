"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { getInitials, getAvatarColor, formatCurrency } from "@/lib/utils/format";
import {
  createExpense,
  updateExpense,
  type ExpenseFormData,
  type ExpenseWithSplits,
} from "@/lib/actions/expenses";
import { toast } from "sonner";
import type { Group, Member, SplitType } from "@/lib/types";

const SPLIT_TYPE_LABELS: Record<SplitType, string> = {
  equal: "A partes iguales",
  exact: "Cantidades exactas",
  percentage: "Por porcentaje",
  shares: "Por partes",
};

interface ExpenseFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: Group;
  members: Member[];
  currentMember: Member;
  editingExpense?: ExpenseWithSplits | null;
}

function buildInitialSplitValues(
  editingExpense: ExpenseWithSplits | null | undefined
): Record<string, string> {
  if (!editingExpense) return {};
  const values: Record<string, string> = {};
  if (editingExpense.split_type === "exact") {
    editingExpense.splits.forEach((s) => {
      values[s.member_id] = s.amount.toFixed(2);
    });
  } else if (editingExpense.split_type === "percentage") {
    const total = editingExpense.amount;
    editingExpense.splits.forEach((s) => {
      values[s.member_id] =
        total > 0 ? ((s.amount / total) * 100).toFixed(1) : "0";
    });
  } else if (editingExpense.split_type === "shares") {
    const amounts = editingExpense.splits.map((s) => s.amount);
    const minAmount = Math.min(...amounts.filter((a) => a > 0));
    editingExpense.splits.forEach((s) => {
      values[s.member_id] =
        minAmount > 0 ? Math.round(s.amount / minAmount).toString() : "1";
    });
  }
  return values;
}

export function ExpenseFormSheet({
  open,
  onOpenChange,
  group,
  members,
  currentMember,
  editingExpense,
}: ExpenseFormSheetProps) {
  // Use a key to force re-mount of form content when opening with different data
  const formKey = open
    ? `${editingExpense?.id || "new"}-${editingExpense?.updated_at || ""}`
    : "closed";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl px-4"
      >
        {open && (
          <ExpenseFormContent
            key={formKey}
            group={group}
            members={members}
            currentMember={currentMember}
            editingExpense={editingExpense}
            onOpenChange={onOpenChange}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Inner form component (re-mounts on each open) ──────

function ExpenseFormContent({
  group,
  members,
  currentMember,
  editingExpense,
  onOpenChange,
}: {
  group: Group;
  members: Member[];
  currentMember: Member;
  editingExpense?: ExpenseWithSplits | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isEditing = !!editingExpense;

  const [paidBy, setPaidBy] = useState(
    editingExpense?.paid_by || currentMember.id
  );
  const [description, setDescription] = useState(
    editingExpense?.description || ""
  );
  const [amountStr, setAmountStr] = useState(
    editingExpense ? editingExpense.amount.toFixed(2) : ""
  );
  const [splitType, setSplitType] = useState<SplitType>(
    editingExpense?.split_type || "equal"
  );
  const [participants, setParticipants] = useState<Set<string>>(
    editingExpense
      ? new Set(editingExpense.splits.map((s) => s.member_id))
      : new Set(members.map((m) => m.id))
  );
  const [splitValues, setSplitValues] = useState<Record<string, string>>(
    () => buildInitialSplitValues(editingExpense)
  );
  const [loading, setLoading] = useState(false);

  const amount = parseFloat(amountStr) || 0;
  const participantList = members.filter((m) => participants.has(m.id));

  // ─── Equal split preview ────────────────────────────────
  const equalPreview = useMemo(() => {
    if (splitType !== "equal" || participantList.length === 0 || amount <= 0)
      return null;
    const base = Math.floor((amount * 100) / participantList.length) / 100;
    const remainder = Math.round(
      (amount - base * participantList.length) * 100
    );
    return participantList.map((m, i) => ({
      member: m,
      amount: i < remainder ? base + 0.01 : base,
    }));
  }, [splitType, participantList, amount]);

  // ─── Validation summaries ───────────────────────────────
  const splitNumericValues = useMemo(() => {
    const result: Record<string, number> = {};
    participantList.forEach((m) => {
      result[m.id] = parseFloat(splitValues[m.id] || "0") || 0;
    });
    return result;
  }, [participantList, splitValues]);

  const exactSum = useMemo(
    () =>
      participantList.reduce(
        (acc, m) => acc + (splitNumericValues[m.id] || 0),
        0
      ),
    [participantList, splitNumericValues]
  );

  const percentageSum = useMemo(
    () =>
      participantList.reduce(
        (acc, m) => acc + (splitNumericValues[m.id] || 0),
        0
      ),
    [participantList, splitNumericValues]
  );

  const sharesTotal = useMemo(
    () =>
      participantList.reduce(
        (acc, m) => acc + (splitNumericValues[m.id] || 0),
        0
      ),
    [participantList, splitNumericValues]
  );

  // ─── Handlers ───────────────────────────────────────────
  const toggleParticipant = useCallback((memberId: string) => {
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        if (next.size > 1) next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }, []);

  const updateSplitValue = useCallback(
    (memberId: string, value: string) => {
      setSplitValues((prev) => ({ ...prev, [memberId]: value }));
    },
    []
  );

  // ─── Submission validation ─────────────────────────────
  const isFormValid = useMemo(() => {
    if (!description.trim() || amount <= 0 || participantList.length === 0)
      return false;
    if (splitType === "exact" && Math.abs(exactSum - amount) > 0.01)
      return false;
    if (splitType === "percentage" && Math.abs(percentageSum - 100) > 0.1)
      return false;
    if (splitType === "shares" && sharesTotal <= 0) return false;
    return true;
  }, [
    description,
    amount,
    participantList.length,
    splitType,
    exactSum,
    percentageSum,
    sharesTotal,
  ]);

  const handleSubmit = async () => {
    if (!isFormValid) return;

    setLoading(true);

    const formData: ExpenseFormData = {
      groupId: group.id,
      paidBy,
      description: description.trim(),
      amount,
      splitType,
      participants: participantList.map((m) => m.id),
      splitValues: splitType !== "equal" ? splitNumericValues : undefined,
    };

    const result = isEditing
      ? await updateExpense(editingExpense!.id, formData)
      : await createExpense(formData);

    if (result.error) {
      toast.error(result.error);
      setLoading(false);
      return;
    }

    toast.success(isEditing ? "Gasto actualizado" : "Gasto añadido");
    onOpenChange(false);
    setLoading(false);
    router.refresh();
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {isEditing ? "Editar gasto" : "Nuevo gasto"}
        </SheetTitle>
      </SheetHeader>

      <div className="mt-4 space-y-5 pb-6">
        {/* Settling warning */}
        {group.status === "settling" && (
          <div className="flex items-start gap-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
            <p className="text-xs text-yellow-800">
              Las cuentas están en proceso de liquidación.{" "}
              {isEditing ? "Editar este gasto" : "Añadir un gasto"}{" "}
              recalculará las transferencias pendientes.
            </p>
          </div>
        )}

        {/* Payer */}
        <div className="space-y-2">
          <Label>Pagado por</Label>
          <Select value={paidBy} onValueChange={setPaidBy}>
            <SelectTrigger className="h-12 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback
                        className={`text-[10px] font-medium ${getAvatarColor(m.display_name)}`}
                      >
                        {getInitials(m.display_name)}
                      </AvatarFallback>
                    </Avatar>
                    {m.display_name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="exp-desc">Descripción</Label>
          <Input
            id="exp-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: Cena en restaurante"
            className="h-12 rounded-xl"
            maxLength={200}
          />
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <Label htmlFor="exp-amount">Importe total</Label>
          <div className="relative">
            <Input
              id="exp-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0,00"
              className="h-12 rounded-xl pr-8"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              €
            </span>
          </div>
        </div>

        {/* Split type */}
        <div className="space-y-2">
          <Label>Tipo de división</Label>
          <Select
            value={splitType}
            onValueChange={(v) => setSplitType(v as SplitType)}
          >
            <SelectTrigger className="h-12 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(
                Object.entries(SPLIT_TYPE_LABELS) as [SplitType, string][]
              ).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Participants */}
        <div className="space-y-2">
          <Label>Participantes</Label>
          <div className="space-y-1">
            {members.map((m) => {
              const isChecked = participants.has(m.id);
              const colors = getAvatarColor(m.display_name);

              return (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleParticipant(m.id)}
                  />
                  <Avatar className="h-7 w-7">
                    <AvatarFallback
                      className={`text-[10px] font-medium ${colors}`}
                    >
                      {getInitials(m.display_name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 text-sm font-medium">
                    {m.display_name}
                  </span>

                  {/* Split input/preview per participant */}
                  {isChecked && amount > 0 && (
                    <SplitInput
                      splitType={splitType}
                      memberId={m.id}
                      amount={amount}
                      equalPreview={equalPreview}
                      splitValues={splitValues}
                      sharesTotal={sharesTotal}
                      updateSplitValue={updateSplitValue}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* Validation summary for non-equal types */}
        {amount > 0 && participantList.length > 0 && (
          <SplitValidation
            splitType={splitType}
            amount={amount}
            exactSum={exactSum}
            percentageSum={percentageSum}
          />
        )}

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={loading || !isFormValid}
          className="h-12 w-full rounded-xl text-sm font-medium"
        >
          {loading
            ? isEditing
              ? "Guardando..."
              : "Añadiendo..."
            : isEditing
              ? "Guardar cambios"
              : "Añadir gasto"}
        </Button>
      </div>
    </>
  );
}

// ─── Split input per row ────────────────────────────────

function SplitInput({
  splitType,
  memberId,
  amount,
  equalPreview,
  splitValues,
  sharesTotal,
  updateSplitValue,
}: {
  splitType: SplitType;
  memberId: string;
  amount: number;
  equalPreview: { member: Member; amount: number }[] | null;
  splitValues: Record<string, string>;
  sharesTotal: number;
  updateSplitValue: (memberId: string, value: string) => void;
}) {
  if (splitType === "equal") {
    const preview = equalPreview?.find((p) => p.member.id === memberId);
    return (
      <span className="text-sm text-muted-foreground">
        {preview ? formatCurrency(preview.amount) : "—"}
      </span>
    );
  }

  if (splitType === "exact") {
    return (
      <div className="relative w-24">
        <Input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={splitValues[memberId] || ""}
          onChange={(e) => updateSplitValue(memberId, e.target.value)}
          placeholder="0,00"
          className="h-8 rounded-lg pr-6 text-right text-sm"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          €
        </span>
      </div>
    );
  }

  if (splitType === "percentage") {
    const pct = parseFloat(splitValues[memberId] || "0") || 0;
    const computed = (amount * pct) / 100;
    return (
      <div className="flex items-center gap-1.5">
        <div className="relative w-20">
          <Input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            max="100"
            value={splitValues[memberId] || ""}
            onChange={(e) => updateSplitValue(memberId, e.target.value)}
            placeholder="0"
            className="h-8 rounded-lg pr-6 text-right text-sm"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            %
          </span>
        </div>
        <span className="w-16 text-right text-xs text-muted-foreground">
          {formatCurrency(computed)}
        </span>
      </div>
    );
  }

  if (splitType === "shares") {
    const shares = parseFloat(splitValues[memberId] || "0") || 0;
    const computed = sharesTotal > 0 ? (amount * shares) / sharesTotal : 0;
    return (
      <div className="flex items-center gap-1.5">
        <div className="relative w-16">
          <Input
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            value={splitValues[memberId] || ""}
            onChange={(e) => updateSplitValue(memberId, e.target.value)}
            placeholder="1"
            className="h-8 rounded-lg text-center text-sm"
          />
        </div>
        <span className="w-16 text-right text-xs text-muted-foreground">
          {formatCurrency(computed)}
        </span>
      </div>
    );
  }

  return null;
}

// ─── Validation footer ──────────────────────────────────

function SplitValidation({
  splitType,
  amount,
  exactSum,
  percentageSum,
}: {
  splitType: SplitType;
  amount: number;
  exactSum: number;
  percentageSum: number;
}) {
  if (splitType === "exact") {
    const diff = amount - exactSum;
    const isValid = Math.abs(diff) < 0.01;
    return (
      <div
        className={`rounded-xl border p-3 text-sm ${
          isValid
            ? "border-green-200 bg-green-50 text-green-700"
            : "border-yellow-200 bg-yellow-50 text-yellow-700"
        }`}
      >
        {isValid
          ? "Las cantidades suman correctamente"
          : `Faltan ${formatCurrency(Math.abs(diff))} ${diff > 0 ? "por asignar" : "(excedido)"}`}
      </div>
    );
  }

  if (splitType === "percentage") {
    const diff = 100 - percentageSum;
    const isValid = Math.abs(diff) < 0.1;
    return (
      <div
        className={`rounded-xl border p-3 text-sm ${
          isValid
            ? "border-green-200 bg-green-50 text-green-700"
            : "border-yellow-200 bg-yellow-50 text-yellow-700"
        }`}
      >
        {isValid
          ? "Los porcentajes suman 100%"
          : `Total: ${percentageSum.toFixed(1)}% (${diff > 0 ? `faltan ${diff.toFixed(1)}%` : `excedido ${Math.abs(diff).toFixed(1)}%`})`}
      </div>
    );
  }

  return null;
}
