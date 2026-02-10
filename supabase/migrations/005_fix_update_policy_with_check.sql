-- Fix the WITH CHECK clause in the UPDATE policy for members table
-- The previous version was too restrictive and prevented linking to placeholders

DROP POLICY IF EXISTS "Members can update group members" ON members;

-- Recreate with a simpler WITH CHECK that allows the update
CREATE POLICY "Members can update group members"
  ON members FOR UPDATE
  USING (
    -- Can update if already a member of the group
    is_group_member(group_id)
    OR
    -- Can update a placeholder (user_id IS NULL) to link it to yourself
    (user_id IS NULL AND auth.uid() IS NOT NULL)
  )
  WITH CHECK (
    -- After update, the user_id must be either the current user or NULL
    -- OR the user must be a member of the group
    (user_id = auth.uid() OR user_id IS NULL OR is_group_member(group_id))
  );
