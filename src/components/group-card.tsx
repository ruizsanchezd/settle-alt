import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Layers } from "lucide-react";
import type { GroupWithMemberCount } from "@/lib/types";
import { STATUS_CONFIG } from "@/lib/constants";

export function GroupCard({ group }: { group: GroupWithMemberCount }) {
  const status = STATUS_CONFIG[group.status];

  return (
    <Link href={`/groups/${group.id}`}>
      <Card className="flex flex-row items-center gap-4 rounded-2xl border p-4 py-4 shadow-xs transition-colors hover:bg-muted/50 active:bg-neutral-50">
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
