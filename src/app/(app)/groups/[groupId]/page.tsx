import { notFound } from "next/navigation";
import { getGroup } from "@/lib/actions/groups";
import { getGroupMembers, getCurrentMember } from "@/lib/actions/members";
import { getGroupExpenses } from "@/lib/actions/expenses";
import { getGroupBalances } from "@/lib/actions/settlements";
import { GroupDetail } from "@/components/group-detail";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;

  // Load all data in parallel on the server to eliminate waterfalls
  const [group, members, currentMember, expenses, balancesData] =
    await Promise.all([
      getGroup(groupId),
      getGroupMembers(groupId),
      getCurrentMember(groupId),
      getGroupExpenses(groupId),
      (async () => {
        const [group, members] = await Promise.all([
          getGroup(groupId),
          getGroupMembers(groupId),
        ]);
        if (!group || !members) return null;
        return getGroupBalances(group.id, members);
      })(),
    ]);

  if (!group || !currentMember) {
    notFound();
  }

  return (
    <GroupDetail
      group={group}
      members={members}
      currentMember={currentMember}
      initialExpenses={expenses}
      initialBalances={balancesData}
    />
  );
}
