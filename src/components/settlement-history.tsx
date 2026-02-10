import { CircleCheck, History } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { Settlement, Member } from "@/lib/types";

interface SettlementHistoryProps {
  settlements: Settlement[];
  members: Member[];
}

export function SettlementHistory({
  settlements,
  members,
}: SettlementHistoryProps) {
  const settledSettlements = settlements.filter((s) => s.settled_at);

  if (settledSettlements.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4" />
        Historial de liquidaciones
      </h3>
      <div className="space-y-2">
        {settledSettlements.map((s) => {
          const fromMember = members.find((m) => m.id === s.from_member);
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
  );
}
