-- =============================================
-- Atomic Operations & Database Improvements
-- =============================================

-- ─── Part A: Atomic RPC functions ────────────

-- Crear gasto con splits en una sola transacción
CREATE OR REPLACE FUNCTION create_expense_with_splits(
  p_group_id UUID,
  p_paid_by UUID,
  p_description TEXT,
  p_amount DECIMAL,
  p_split_type split_type,
  p_created_by UUID,
  p_splits JSONB
) RETURNS UUID AS $$
DECLARE
  v_expense_id UUID;
BEGIN
  -- Validate user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO expenses (group_id, paid_by, description, amount, split_type, created_by)
  VALUES (p_group_id, p_paid_by, p_description, p_amount, p_split_type, p_created_by)
  RETURNING id INTO v_expense_id;

  INSERT INTO expense_splits (expense_id, member_id, amount)
  SELECT v_expense_id, (s->>'memberId')::UUID, (s->>'amount')::DECIMAL
  FROM jsonb_array_elements(p_splits) s;

  RETURN v_expense_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Actualizar gasto y reemplazar splits atómicamente
CREATE OR REPLACE FUNCTION update_expense_with_splits(
  p_expense_id UUID,
  p_paid_by UUID,
  p_description TEXT,
  p_amount DECIMAL,
  p_split_type split_type,
  p_splits JSONB
) RETURNS UUID AS $$
BEGIN
  -- Validate user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE expenses
  SET paid_by = p_paid_by,
      description = p_description,
      amount = p_amount,
      split_type = p_split_type,
      updated_at = NOW()
  WHERE id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found: %', p_expense_id;
  END IF;

  DELETE FROM expense_splits WHERE expense_id = p_expense_id;

  INSERT INTO expense_splits (expense_id, member_id, amount)
  SELECT p_expense_id, (s->>'memberId')::UUID, (s->>'amount')::DECIMAL
  FROM jsonb_array_elements(p_splits) s;

  RETURN p_expense_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Crear grupo y añadir al creador como miembro atómicamente
CREATE OR REPLACE FUNCTION create_group_with_member(
  p_name TEXT,
  p_description TEXT,
  p_emoji TEXT,
  p_created_by UUID,
  p_display_name TEXT
) RETURNS UUID AS $$
DECLARE
  v_group_id UUID;
BEGIN
  -- Validate user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO groups (name, description, emoji, created_by)
  VALUES (p_name, p_description, p_emoji, p_created_by)
  RETURNING id INTO v_group_id;

  INSERT INTO members (group_id, user_id, display_name)
  VALUES (v_group_id, p_created_by, p_display_name);

  RETURN v_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Part C: Fix foreign keys ────────────────

-- members.user_id → SET NULL cuando el usuario se elimina
-- (el member se convierte en placeholder, manteniendo el historial)
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_user_id_fkey;
ALTER TABLE members ADD CONSTRAINT members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- groups.created_by → SET NULL cuando el creador se elimina
ALTER TABLE groups ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_created_by_fkey;
ALTER TABLE groups ADD CONSTRAINT groups_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- ─── Part D: Composite indexes ───────────────

-- Optimizar queries de gastos por grupo ordenados por fecha
CREATE INDEX IF NOT EXISTS expenses_group_created_idx
  ON expenses (group_id, created_at DESC);

-- Optimizar queries de settlements por grupo ordenados por fecha
CREATE INDEX IF NOT EXISTS settlements_group_created_idx
  ON settlements (group_id, created_at DESC);
