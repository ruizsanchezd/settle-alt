-- =============================================
-- Settle Alt — Initial Schema
-- =============================================

-- 1. Custom types
CREATE TYPE group_status AS ENUM ('active', 'settling', 'archived');
CREATE TYPE split_type AS ENUM ('equal', 'exact', 'percentage', 'shares');

-- 2. Users table (synced from Supabase Auth via trigger)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Groups table
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status group_status NOT NULL DEFAULT 'active',
  created_by UUID NOT NULL REFERENCES users(id),
  invite_code TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  frozen_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Members table
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique partial index: one user can only be linked once per group
CREATE UNIQUE INDEX members_group_user_unique
  ON members (group_id, user_id)
  WHERE user_id IS NOT NULL;

-- Index for fast lookups by user
CREATE INDEX members_user_id_idx ON members (user_id) WHERE user_id IS NOT NULL;

-- Index for fast lookups by group
CREATE INDEX members_group_id_idx ON members (group_id);

-- 5. Expenses table
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  paid_by UUID NOT NULL REFERENCES members(id),
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  split_type split_type NOT NULL DEFAULT 'equal',
  image_url TEXT,
  created_by UUID NOT NULL REFERENCES members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX expenses_group_id_idx ON expenses (group_id);

-- 6. Expense splits table
CREATE TABLE expense_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id),
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX expense_splits_expense_id_idx ON expense_splits (expense_id);
CREATE INDEX expense_splits_member_id_idx ON expense_splits (member_id);

-- 7. Settlements table
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_member UUID NOT NULL REFERENCES members(id),
  to_member UUID NOT NULL REFERENCES members(id),
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX settlements_group_id_idx ON settlements (group_id);

-- =============================================
-- Auth trigger: auto-create user row on signup
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- Row Level Security
-- =============================================

-- Helper: check if current user is a member of a group
CREATE OR REPLACE FUNCTION is_group_member(g_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM members
    WHERE group_id = g_id
      AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- USERS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can view members of shared groups"
  ON users FOR SELECT
  USING (
    id IN (
      SELECT m.user_id FROM members m
      WHERE m.user_id IS NOT NULL
        AND m.group_id IN (
          SELECT m2.group_id FROM members m2 WHERE m2.user_id = auth.uid()
        )
    )
  );

-- GROUPS
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their groups"
  ON groups FOR SELECT
  USING (is_group_member(id));

CREATE POLICY "Any authenticated user can create a group"
  ON groups FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Members can update their groups"
  ON groups FOR UPDATE
  USING (is_group_member(id));

-- Also allow reading a group by invite_code (for join flow)
CREATE POLICY "Anyone authenticated can view group by invite code"
  ON groups FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- MEMBERS
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view group members"
  ON members FOR SELECT
  USING (is_group_member(group_id));

CREATE POLICY "Members can insert into their groups"
  ON members FOR INSERT
  WITH CHECK (
    is_group_member(group_id)
    OR
    -- Allow the creator to add themselves when creating the group
    group_id IN (SELECT g.id FROM groups g WHERE g.created_by = auth.uid())
  );

CREATE POLICY "Members can update group members"
  ON members FOR UPDATE
  USING (is_group_member(group_id));

-- EXPENSES
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view group expenses"
  ON expenses FOR SELECT
  USING (is_group_member(group_id));

CREATE POLICY "Members can create expenses in active/settling groups"
  ON expenses FOR INSERT
  WITH CHECK (
    is_group_member(group_id)
    AND (SELECT status FROM groups WHERE id = group_id) != 'archived'
  );

CREATE POLICY "Members can update expenses in active/settling groups"
  ON expenses FOR UPDATE
  USING (
    is_group_member(group_id)
    AND (SELECT status FROM groups WHERE id = group_id) != 'archived'
  );

CREATE POLICY "Members can delete expenses in active/settling groups"
  ON expenses FOR DELETE
  USING (
    is_group_member(group_id)
    AND (SELECT status FROM groups WHERE id = group_id) != 'archived'
  );

-- EXPENSE SPLITS
ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view expense splits"
  ON expense_splits FOR SELECT
  USING (
    expense_id IN (
      SELECT e.id FROM expenses e WHERE is_group_member(e.group_id)
    )
  );

CREATE POLICY "Members can manage expense splits"
  ON expense_splits FOR INSERT
  WITH CHECK (
    expense_id IN (
      SELECT e.id FROM expenses e
      WHERE is_group_member(e.group_id)
        AND (SELECT status FROM groups WHERE id = e.group_id) != 'archived'
    )
  );

CREATE POLICY "Members can delete expense splits"
  ON expense_splits FOR DELETE
  USING (
    expense_id IN (
      SELECT e.id FROM expenses e WHERE is_group_member(e.group_id)
    )
  );

-- SETTLEMENTS
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view settlements"
  ON settlements FOR SELECT
  USING (is_group_member(group_id));

CREATE POLICY "Members can create settlements"
  ON settlements FOR INSERT
  WITH CHECK (
    is_group_member(group_id)
    AND (SELECT status FROM groups WHERE id = group_id) != 'archived'
  );

CREATE POLICY "Members can update settlements"
  ON settlements FOR UPDATE
  USING (
    is_group_member(group_id)
    AND (SELECT status FROM groups WHERE id = group_id) != 'archived'
  );
