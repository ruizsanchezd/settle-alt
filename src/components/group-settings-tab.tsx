"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  UserPlus,
  Link2,
  Archive,
  Check,
  User,
  AlertTriangle,
  History,
  CircleCheck,
} from "lucide-react";
import { addPlaceholderMember } from "@/lib/actions/members";
import { archiveGroup } from "@/lib/actions/groups";
import { getGroupSettlements } from "@/lib/actions/settlements";
import { getInitials, getAvatarColor, formatCurrency, formatDate } from "@/lib/utils/format";
import { toast } from "sonner";
import type { Group, Member, Settlement } from "@/lib/types";

export function GroupSettingsTab({
  group,
  members: initialMembers,
}: {
  group: Group;
  members: Member[];
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [newName, setNewName] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [copied, setCopied] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [settlements, setSettlements] = useState<Settlement[]>([]);

  const isArchived = group.status === "archived";

  useEffect(() => {
    getGroupSettlements(group.id).then(setSettlements).catch(() => {});
  }, [group.id]);

  const handleAddMember = async () => {
    if (!newName.trim()) return;
    setAddingMember(true);

    const result = await addPlaceholderMember(group.id, newName.trim());

    if (result.error) {
      toast.error(result.error);
    } else if (result.member) {
      setMembers((prev) => [...prev, result.member!]);
      setNewName("");
      toast.success(`${result.member.display_name} añadido al grupo`);
    }

    setAddingMember(false);
  };

  const handleCopyLink = async () => {
    const link = `${window.location.origin}/join/${group.invite_code}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Enlace copiado");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleArchive = async () => {
    setArchiving(true);
    const result = await archiveGroup(group.id);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Grupo archivado");
      setArchiveDialogOpen(false);
      router.push("/");
    }

    setArchiving(false);
  };

  return (
    <div className="space-y-6">
      {/* Members section */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">
          Miembros ({members.length})
        </h3>
        <div className="space-y-2">
          {members.map((member) => {
            const colors = getAvatarColor(member.display_name);
            return (
              <div
                key={member.id}
                className="flex items-center gap-3 rounded-xl border p-3"
              >
                <Avatar className="h-9 w-9">
                  <AvatarFallback className={`text-xs font-medium ${colors}`}>
                    {getInitials(member.display_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">
                    {member.display_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {member.user_id ? (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        Cuenta vinculada
                      </span>
                    ) : (
                      "Sin vincular"
                    )}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add placeholder member */}
        {!isArchived && (
          <div className="mt-3 flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre del miembro"
              className="h-11 rounded-xl"
              maxLength={50}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddMember();
                }
              }}
            />
            <Button
              onClick={handleAddMember}
              disabled={!newName.trim() || addingMember}
              size="icon"
              className="h-11 w-11 shrink-0 rounded-xl"
            >
              <UserPlus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <Separator />

      {/* Invite link */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Enlace de invitación</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Comparte este enlace para que otros se unan al grupo
        </p>
        <Button
          variant="outline"
          onClick={handleCopyLink}
          className="h-11 w-full justify-start gap-2 rounded-xl text-sm"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
          {copied ? "Copiado" : "Copiar enlace de invitación"}
        </Button>
      </div>

      {/* Settlement history */}
      {settlements.length > 0 && (
        <>
          <Separator />
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4" />
              Historial de liquidaciones
            </h3>
            <div className="space-y-2">
              {settlements.map((s) => {
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
                        {s.settled_at ? formatDate(s.settled_at) : "Pendiente"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Archive */}
      {!isArchived && (
        <>
          <Separator />
          <div>
            <h3 className="mb-3 text-sm font-semibold">Zona de peligro</h3>
            <Dialog
              open={archiveDialogOpen}
              onOpenChange={setArchiveDialogOpen}
            >
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="h-11 w-full justify-start gap-2 rounded-xl text-sm text-destructive hover:text-destructive"
                >
                  <Archive className="h-4 w-4" />
                  Archivar grupo
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Archivar grupo</DialogTitle>
                  <DialogDescription>
                    El grupo pasará a modo solo lectura. No se podrán añadir
                    más gastos ni liquidaciones.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex items-start gap-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
                  <p className="text-xs text-yellow-800">
                    Si quedan deudas pendientes, seguirán visibles pero no se
                    podrán saldar.
                  </p>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setArchiveDialogOpen(false)}
                    className="rounded-xl"
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleArchive}
                    disabled={archiving}
                    className="rounded-xl"
                    variant="destructive"
                  >
                    {archiving ? "Archivando..." : "Archivar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </>
      )}
    </div>
  );
}
