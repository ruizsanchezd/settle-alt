import { notFound } from "next/navigation";
import { getGroup } from "@/lib/actions/groups";
import { getGroupMembers, getCurrentMember } from "@/lib/actions/members";
import { GroupDetail } from "@/components/group-detail";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const [group, members, currentMember] = await Promise.all([
    getGroup(groupId),
    getGroupMembers(groupId),
    getCurrentMember(groupId),
  ]);

  if (!group || !currentMember) {
    notFound();
  }

  return (
    <GroupDetail
      group={group}
      members={members}
      currentMember={currentMember}
    />
  );
}
