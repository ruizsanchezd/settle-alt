export type GroupStatus = "active" | "settling" | "archived";
export type SplitType = "equal" | "exact" | "percentage" | "shares";

export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  status: GroupStatus;
  created_by: string;
  invite_code: string;
  frozen_at: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface Member {
  id: string;
  group_id: string;
  user_id: string | null;
  display_name: string;
  created_at: string;
}

export interface Expense {
  id: string;
  group_id: string;
  paid_by: string;
  description: string;
  amount: number;
  split_type: SplitType;
  image_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  member_id: string;
  amount: number;
  created_at: string;
}

export interface Settlement {
  id: string;
  group_id: string;
  from_member: string;
  to_member: string;
  amount: number;
  settled_at: string | null;
  created_at: string;
}

// Partial type returned by the get_group_preview_by_invite RPC
export interface GroupPreview {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  status: GroupStatus;
}

// Extended types with joins
export interface GroupWithMemberCount extends Group {
  member_count: number;
}

export interface MemberWithUser extends Member {
  user: User | null;
}
