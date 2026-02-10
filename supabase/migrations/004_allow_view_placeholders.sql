-- Allow authenticated users to view placeholder members (for join flow)
-- This allows new users coming from invite links to see existing placeholders
-- so they can link their account to them

CREATE POLICY "Authenticated users can view placeholder members"
  ON members FOR SELECT
  USING (
    -- Allow viewing placeholder members (not linked to any user)
    user_id IS NULL AND auth.uid() IS NOT NULL
  );
