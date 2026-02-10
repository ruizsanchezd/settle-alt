-- =============================================
-- Migration 006: Fix RLS Security Vulnerabilities
-- Addresses: Audit findings #1, #2, #3
-- =============================================

-- 1. Remove the overly permissive groups SELECT policy (#1)
--    This policy allowed ANY authenticated user to read ALL groups,
--    effectively leaking invite_codes and group data.
DROP POLICY IF EXISTS "Anyone authenticated can view group by invite code" ON groups;

-- 2. Remove the overly permissive members SELECT policy for placeholders (#3)
--    This policy allowed ANY authenticated user to see placeholder members
--    across ALL groups, leaking member names.
DROP POLICY IF EXISTS "Authenticated users can view placeholder members" ON members;

-- 3. Restrict the members UPDATE policy (#2)
--    The previous policy allowed any authenticated user to update any
--    placeholder member in any group. Since joinGroup uses createAdminClient()
--    to bypass RLS for placeholder linking, we only need this policy for
--    existing group members updating within their own groups.
DROP POLICY IF EXISTS "Members can update group members" ON members;

CREATE POLICY "Members can update group members"
  ON members FOR UPDATE
  USING (is_group_member(group_id))
  WITH CHECK (is_group_member(group_id));

-- 4. Create RPC for the join flow: group preview by invite code
--    Returns only the fields needed for the join page (no invite_code exposed).
CREATE OR REPLACE FUNCTION get_group_preview_by_invite(code TEXT)
RETURNS TABLE(id UUID, name TEXT, description TEXT, emoji TEXT, status group_status) AS $$
  SELECT g.id, g.name, g.description, g.emoji, g.status
  FROM groups g
  WHERE g.invite_code = code;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 5. Create RPC for the join flow: placeholder members by invite code
--    Only returns unlinked members (user_id IS NULL) for the matching group.
--    Requires authentication.
CREATE OR REPLACE FUNCTION get_group_placeholders(code TEXT)
RETURNS TABLE(id UUID, display_name TEXT) AS $$
  SELECT m.id, m.display_name
  FROM members m
  JOIN groups g ON g.id = m.group_id
  WHERE g.invite_code = code
    AND m.user_id IS NULL
    AND auth.uid() IS NOT NULL;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
