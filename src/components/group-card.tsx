import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Layers } from "lucide-react";
import type { GroupWithMemberCount } from "@/lib/types";

const STATUS_CONFIG = {
  active: { label: "Activo", className: "bg-green-50 text-green-700 border-green-200" },
  settling: { label: "Liquidando", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  archived: { label: "Archivado", className: "bg-neutral-100 text-neutral-500 border-neutral-200" },
} as const;

export function GroupCard({ group }: { group: GroupWithMemberCount }) {
  const status = STATUS_CONFIG[group.status];

  return (
    <Link href={`/groups/${group.id}`}>
      <Card className="flex items-center gap-4 rounded-2xl border p-4 transition-colors hover:bg-muted/50 active:bg-neutral-50">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-xl">
          {group.emoji || <Layers className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">{group.name}</h3>
            <Badge
              variant="outline"
              className={`shrink-0 text-[11px] font-medium ${status.className}`}
            >
              {status.label}
            </Badge>
          </div>
          {group.description && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {group.description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>
              {group.member_count}{" "}
              {group.member_count === 1 ? "miembro" : "miembros"}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
