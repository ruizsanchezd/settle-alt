"use client";

import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import type { Group, Member } from "@/lib/types";
import { GroupExpensesTab } from "@/components/group-expenses-tab";
import { GroupBalancesTab } from "@/components/group-balances-tab";
import { GroupSettingsTab } from "@/components/group-settings-tab";

const STATUS_CONFIG = {
  active: { label: "Activo", className: "bg-green-50 text-green-700 border-green-200" },
  settling: { label: "Liquidando", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  archived: { label: "Archivado", className: "bg-neutral-100 text-neutral-500 border-neutral-200" },
} as const;

export function GroupDetail({
  group,
  members,
  currentMember,
}: {
  group: Group;
  members: Member[];
  currentMember: Member;
}) {
  const router = useRouter();
  const status = STATUS_CONFIG[group.status];

  return (
    <div className="mx-auto max-w-lg">
      {/* Header */}
      <div className="border-b px-4 pb-4 pt-2">
        <button
          onClick={() => router.push("/")}
          className="mb-3 flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Grupos
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">{group.name}</h1>
          <Badge
            variant="outline"
            className={`text-[11px] font-medium ${status.className}`}
          >
            {status.label}
          </Badge>
        </div>
        {group.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {group.description}
          </p>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="expenses" className="w-full">
        <TabsList className="sticky top-14 z-40 grid h-11 w-full grid-cols-3 rounded-none bg-background px-4">
          <TabsTrigger value="expenses" className="text-sm">
            Gastos
          </TabsTrigger>
          <TabsTrigger value="balances" className="text-sm">
            Balances
          </TabsTrigger>
          <TabsTrigger value="settings" className="text-sm">
            Ajustes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="mt-0 px-4 py-4">
          <GroupExpensesTab
            group={group}
            members={members}
            currentMember={currentMember}
          />
        </TabsContent>

        <TabsContent value="balances" className="mt-0 px-4 py-4">
          <GroupBalancesTab group={group} members={members} />
        </TabsContent>

        <TabsContent value="settings" className="mt-0 px-4 py-4">
          <GroupSettingsTab group={group} members={members} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
