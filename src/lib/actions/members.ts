"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Member } from "@/lib/types";

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
  console.log("🔵 joinGroup server action called", { inviteCode, memberId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  console.log("🔵 User:", user?.id);

  if (!user) {
    console.error("🔴 No user authenticated");
    return { error: "No autenticado" };
  }

  // Find group by invite code
  const { data: group } = await supabase
    .from("groups")
    .select("*")
    .eq("invite_code", inviteCode)
    .single();

  if (!group) return { error: "Grupo no encontrado" };

  if (group.status === "archived") {
    return { error: "Este grupo está archivado" };
  }

  // Check if user is already a member
  const { data: existingMember } = await supabase
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
    // Link to existing placeholder member
    const { data: placeholder, error: selectError } = await supabase
      .from("members")
      .select("*")
      .eq("id", memberId)
      .eq("group_id", group.id)
      .is("user_id", null)
      .single();

    if (selectError) {
      console.error("Error al buscar placeholder:", selectError);
      return { error: `Error al buscar miembro: ${selectError.message}` };
    }

    if (!placeholder) {
      return { error: "Miembro no encontrado o ya vinculado" };
    }

    const { error: updateError } = await supabase
      .from("members")
      .update({ user_id: user.id })
      .eq("id", memberId);

    if (updateError) {
      console.error("Error al vincular miembro:", updateError);
      return { error: `Error al vincular: ${updateError.message}` };
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
