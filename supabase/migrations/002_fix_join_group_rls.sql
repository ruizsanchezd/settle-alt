-- Fix RLS policies to allow users to join groups via invite codes
-- This migration updates the members table policies to support:
-- 1. Users adding themselves to groups (new members)
-- 2. Users linking their account to placeholder members

-- Drop existing policies that are too restrictive
DROP POLICY IF EXISTS "Members can insert into their groups" ON members;
DROP POLICY IF EXISTS "Members can update group members" ON members;

-- Updated INSERT policy: allow users to add themselves
CREATE POLICY "Members can insert into their groups"
  ON members FOR INSERT
  WITH CHECK (
    -- Existing members can add new members
    is_group_member(group_id)
    OR
    -- Group creator can add themselves
    group_id IN (SELECT g.id FROM groups g WHERE g.created_by = auth.uid())
    OR
    -- Authenticated users can add themselves via join flow
    user_id = auth.uid()
  );

-- Updated UPDATE policy: allow linking to placeholders + existing functionality
CREATE POLICY "Members can update group members"
  ON members FOR UPDATE
  USING (
    -- Existing: members can update within their groups
    is_group_member(group_id)
    OR
    -- New: allow linking own user_id to a placeholder
    (user_id IS NULL AND auth.uid() IS NOT NULL)
  )
  WITH CHECK (
    -- After update, ensure it's either their own user_id or they're a group member
    user_id = auth.uid() OR is_group_member(group_id)
  );
