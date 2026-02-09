import { createClient } from "@/lib/supabase/server";
import { getMyGroups } from "@/lib/actions/groups";
import { CreateGroupSheet } from "@/components/create-group-sheet";
import { GroupCard } from "@/components/group-card";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const displayName =
    user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";

  const groups = await getMyGroups();

  const activeGroups = groups.filter((g) => g.status !== "archived");
  const archivedGroups = groups.filter((g) => g.status === "archived");

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">Hola, {displayName}</h2>
        <p className="text-sm text-muted-foreground">
          Tus grupos de gastos compartidos
        </p>
      </div>

      <div className="mt-6">
        <CreateGroupSheet />
      </div>

      {activeGroups.length === 0 && archivedGroups.length === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed py-12">
          <p className="text-sm text-muted-foreground">
            Aún no tienes grupos
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Crea uno para empezar a dividir gastos
          </p>
        </div>
      ) : (
        <>
          {activeGroups.length > 0 && (
            <div className="mt-6 space-y-3">
              {activeGroups.map((group) => (
                <GroupCard key={group.id} group={group} />
              ))}
            </div>
          )}

          {archivedGroups.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-3 text-sm font-medium text-muted-foreground">
                Archivados
              </h3>
              <div className="space-y-3">
                {archivedGroups.map((group) => (
                  <GroupCard key={group.id} group={group} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
