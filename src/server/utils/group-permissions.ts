import { GroupRole } from "../../shared/group-roles";
import type { PublicGroup } from "./groups";

export type GroupPermissionAction =
  | "group.settings.update"
  | "group.delete"
  | "member.add"
  | "import"
  | "expense.create"
  | "expense.manage.any"
  | "recurring.create"
  | "recurring.manage.any"
  | { type: "member.remove"; targetUserId: string }
  | { type: "member.role.change"; targetUserId: string; role: GroupRole }
  | { type: "expense.update" | "expense.delete"; ownerId: string }
  | { type: "recurring.update" | "recurring.delete"; ownerId: string }
  | { type: "settlement.create"; debtorId: string }
  | { type: "settlement.delete"; recorderId: string };

export interface PermissionUser {
  id: string;
}

export function groupRoleForUser(
  group: Pick<PublicGroup, "members">,
  userId: string,
): GroupRole | null {
  return group.members.find((member) => member.userId === userId)?.role ?? null;
}

export function canGroupAction(
  user: PermissionUser,
  group: Pick<PublicGroup, "members">,
  action: GroupPermissionAction,
): boolean {
  const role = groupRoleForUser(group, user.id);
  if (!role) return false;

  const isElevated = role === GroupRole.Creator || role === GroupRole.Admin;
  if (typeof action === "string") {
    switch (action) {
      case "group.settings.update":
        return isElevated;
      case "group.delete":
        return role === GroupRole.Creator;
      case "expense.create":
      case "recurring.create":
        return true;
      case "member.add":
      case "import":
      case "expense.manage.any":
      case "recurring.manage.any":
        return isElevated;
    }
  }

  switch (action.type) {
    case "member.remove": {
      const targetRole = groupRoleForUser(group, action.targetUserId);
      if (!targetRole || targetRole === GroupRole.Creator) return false;
      if (action.targetUserId === user.id) return true;
      return isElevated;
    }
    case "member.role.change": {
      const targetRole = groupRoleForUser(group, action.targetUserId);
      if (!targetRole || targetRole === GroupRole.Creator) return false;
      if (action.role === GroupRole.Creator) {
        return role === GroupRole.Creator && action.targetUserId !== user.id;
      }
      return isElevated;
    }
    case "expense.update":
    case "expense.delete":
    case "recurring.update":
    case "recurring.delete":
      return isElevated || action.ownerId === user.id;
    case "settlement.create":
      return isElevated || action.debtorId === user.id;
    case "settlement.delete":
      return action.recorderId === user.id;
  }
}
