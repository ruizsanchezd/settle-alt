-- =============================================
-- Optimize Data Loading
-- =============================================

-- RPC for getMyGroups with member count in single query
CREATE OR REPLACE FUNCTION get_my_groups()
RETURNS TABLE(
  id UUID,
  name TEXT,
  description TEXT,
  emoji TEXT,
  status group_status,
  created_at TIMESTAMPTZ,
  invite_code TEXT,
  created_by UUID,
  frozen_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  member_count BIGINT
) AS $$
  SELECT g.id, g.name, g.description, g.emoji,
         g.status, g.created_at, g.invite_code, g.created_by,
         g.frozen_at, g.archived_at,
         COUNT(m2.id) as member_count
  FROM groups g
  JOIN members m ON m.group_id = g.id AND m.user_id = auth.uid()
  JOIN members m2 ON m2.group_id = g.id
  GROUP BY g.id
  ORDER BY g.created_at DESC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
