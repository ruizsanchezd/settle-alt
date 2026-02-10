"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Member } from "@/lib/types";

export async function getPlaceholdersByInviteCode(
  code: string
): Promise<{ id: string; display_name: string }[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("get_group_placeholders", { code });

  if (error || !data) return [];
  return data;
}

export async function getGroupMembers(groupId: string): Promise<Member[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function addPlaceholderMember(
  groupId: string,
  displayName: string
): Promise<{ member?: Member; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  if (!displayName || displayName.trim().length === 0) {
    return { error: "El nombre es obligatorio" };
  }

  if (displayName.trim().length > 50) {
    return { error: "El nombre no puede superar los 50 caracteres" };
  }

  const { data, error } = await supabase
    .from("members")
    .insert({
      group_id: groupId,
      user_id: null,
      display_name: displayName.trim(),
    })
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/groups/${groupId}`);
  return { member: data };
}

export async function joinGroup(
  inviteCode: string,
  memberId: string | null
): Promise<{ groupId?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  // Find group by invite code via RPC (works for non-members)
  const { data: groups, error: rpcError } = await supabase
    .rpc("get_group_preview_by_invite", { code: inviteCode });

  if (rpcError || !groups || groups.length === 0) {
    return { error: "Grupo no encontrado" };
  }

  const group = groups[0];

  if (group.status === "archived") {
    return { error: "Este grupo está archivado" };
  }

  // Use admin client for member queries (user may not be a member yet)
  const adminSupabase = createAdminClient();

  // Check if user is already a member
  const { data: existingMember } = await adminSupabase
    .from("members")
    .select("id")
    .eq("group_id", group.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingMember) {
    return { groupId: group.id };
  }

  // Get user display name
  const { data: userData } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const displayName =
    userData?.display_name || user.email?.split("@")[0] || "Usuario";

  if (memberId) {
    // Validate placeholder exists and belongs to this group
    const { data: placeholder } = await adminSupabase
      .from("members")
      .select("id")
      .eq("id", memberId)
      .eq("group_id", group.id)
      .is("user_id", null)
      .single();

    if (!placeholder) {
      return { error: "Miembro no encontrado o ya vinculado" };
    }

    // Atomically link placeholder — only updates if user_id is still NULL
    // This prevents race conditions where two users try to claim the same placeholder
    const { data: updated, error: updateError } = await adminSupabase
      .from("members")
      .update({ user_id: user.id })
      .eq("id", memberId)
      .is("user_id", null)
      .select();

    if (updateError) {
      return { error: `Error al vincular: ${updateError.message}` };
    }

    if (!updated || updated.length === 0) {
      return { error: "Este miembro ya fue vinculado por otra persona. Vuelve a intentarlo seleccionando otro." };
    }
  } else {
    // Create new member
    const { error } = await supabase.from("members").insert({
      group_id: group.id,
      user_id: user.id,
      display_name: displayName,
    });

    if (error) {
      if (error.code === "23505") {
        // Unique constraint — already a member
        return { groupId: group.id };
      }
      return { error: error.message };
    }
  }

  revalidatePath(`/groups/${group.id}`);
  revalidatePath("/");
  return { groupId: group.id };
}

export async function getCurrentMember(groupId: string): Promise<Member | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("members")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  return data;
}
