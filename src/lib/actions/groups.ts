"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Group, GroupPreview, GroupWithMemberCount } from "@/lib/types";

export async function getMyGroups(): Promise<GroupWithMemberCount[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  // Get groups where the user is a member
  const { data: memberRows } = await supabase
    .from("members")
    .select("group_id")
    .eq("user_id", user.id);

  if (!memberRows || memberRows.length === 0) return [];

  const groupIds = memberRows.map((m) => m.group_id);

  const { data: groups, error } = await supabase
    .from("groups")
    .select("*")
    .in("id", groupIds)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!groups) return [];

  // Get member counts for each group
  const { data: counts } = await supabase
    .from("members")
    .select("group_id")
    .in("group_id", groupIds);

  const countMap: Record<string, number> = {};
  counts?.forEach((m) => {
    countMap[m.group_id] = (countMap[m.group_id] || 0) + 1;
  });

  return groups.map((g) => ({
    ...g,
    member_count: countMap[g.id] || 0,
  }));
}

export async function createGroup(formData: FormData): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const emoji = (formData.get("emoji") as string) || null;

  if (!name || name.length === 0) {
    return { error: "El nombre del grupo es obligatorio" };
  }

  if (name.length > 100) {
    return { error: "El nombre no puede superar los 100 caracteres" };
  }

  if (description && description.length > 500) {
    return { error: "La descripción es demasiado larga" };
  }

  // Get user display name
  const { data: userData } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const displayName =
    userData?.display_name || user.email?.split("@")[0] || "Usuario";

  // Create group with member atomically via RPC
  const { data: groupId, error: rpcError } = await supabase.rpc(
    "create_group_with_member",
    {
      p_name: name,
      p_description: description,
      p_emoji: emoji || null,
      p_created_by: user.id,
      p_display_name: displayName,
    }
  );

  if (rpcError) return { error: rpcError.message };

  revalidatePath("/");
  return { id: groupId };
}

export async function getGroup(groupId: string): Promise<Group | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .single();

  if (error) return null;
  return data;
}

export async function getGroupByInviteCode(code: string): Promise<GroupPreview | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("get_group_preview_by_invite", { code });

  if (error || !data || data.length === 0) return null;
  return data[0];
}

export async function updateGroupEmoji(
  groupId: string,
  emoji: string | null
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("groups")
    .update({ emoji })
    .eq("id", groupId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/groups/${groupId}`);
  revalidatePath("/");
  return { success: true };
}

export async function archiveGroup(groupId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("groups")
    .update({
      status: "archived" as const,
      archived_at: new Date().toISOString(),
    })
    .eq("id", groupId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/groups/${groupId}`);
  revalidatePath("/");
  return { success: true };
}
