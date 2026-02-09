"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, UserPlus, Check } from "lucide-react";
import { joinGroup } from "@/lib/actions/members";
import { getInitials, getAvatarColor } from "@/lib/utils/format";
import { toast } from "sonner";
import type { Group, Member } from "@/lib/types";

export function JoinGroupFlow({
  group,
  inviteCode,
  placeholders,
}: {
  group: Group;
  inviteCode: string;
  placeholders: Member[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    setLoading(true);
    const result = await joinGroup(inviteCode, selectedId);

    if (result.error) {
      toast.error(result.error);
      setLoading(false);
      return;
    }

    if (result.groupId) {
      router.push(`/groups/${result.groupId}`);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        {/* Group info */}
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <Users className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="mt-4 text-xl font-bold">{group.name}</h1>
          {group.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {group.description}
            </p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            Te han invitado a unirte a este grupo
          </p>
        </div>

        {/* Identity selection */}
        {placeholders.length > 0 && (
          <div>
            <p className="mb-3 text-sm font-medium">
              ¿Eres alguno de estos miembros?
            </p>
            <div className="space-y-2">
              {placeholders.map((p) => {
                const colors = getAvatarColor(p.display_name);
                const isSelected = selectedId === p.id;

                return (
                  <Card
                    key={p.id}
                    onClick={() =>
                      setSelectedId(isSelected ? null : p.id)
                    }
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "active:bg-neutral-50"
                    }`}
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback
                        className={`text-xs font-medium ${colors}`}
                      >
                        {getInitials(p.display_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 text-sm font-medium">
                      {p.display_name}
                    </span>
                    {isSelected && (
                      <Check className="h-5 w-5 text-primary" />
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <Button
            onClick={handleJoin}
            disabled={loading}
            className="h-12 w-full rounded-xl text-sm font-medium"
          >
            {loading
              ? "Uniéndose..."
              : selectedId
                ? "Vincularme a este miembro"
                : "Unirme como nuevo miembro"}
          </Button>

          {selectedId && (
            <Button
              variant="ghost"
              onClick={() => setSelectedId(null)}
              className="h-10 w-full text-sm text-muted-foreground"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Unirme como nuevo miembro
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
