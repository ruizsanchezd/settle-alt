import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getGroupByInviteCode } from "@/lib/actions/groups";
import { getGroupMembers } from "@/lib/actions/members";
import { JoinGroupFlow } from "@/components/join-group-flow";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If not logged in, redirect to login with return URL
  if (!user) {
    redirect(`/login?redirect=/join/${code}`);
  }

  const group = await getGroupByInviteCode(code);

  if (!group) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-xl font-bold">Enlace no válido</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este enlace de invitación no existe o ha caducado.
          </p>
        </div>
      </div>
    );
  }

  if (group.status === "archived") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-xl font-bold">Grupo archivado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este grupo ya está archivado y no acepta nuevos miembros.
          </p>
        </div>
      </div>
    );
  }

  // Check if user is already a member
  const members = await getGroupMembers(group.id);
  const existingMember = members.find((m) => m.user_id === user.id);

  if (existingMember) {
    redirect(`/groups/${group.id}`);
  }

  // Show unlinked placeholders (no user_id)
  const placeholders = members.filter((m) => !m.user_id);

  return (
    <JoinGroupFlow
      group={group}
      inviteCode={code}
      placeholders={placeholders}
    />
  );
}
