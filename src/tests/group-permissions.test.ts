import { describe, expect, it } from "vitest";
import { GroupRole } from "../shared/group-roles";
import { canGroupAction } from "../server/utils/group-permissions";

const group = {
  members: [
    { userId: "creator", role: GroupRole.Creator },
    { userId: "admin", role: GroupRole.Admin },
    { userId: "member", role: GroupRole.Member },
    { userId: "other", role: GroupRole.Member },
  ],
};

describe("group role permissions", () => {
  it("lets members add expenses but not people, imports or settings", () => {
    const member = { id: "member", role: "admin" };
    expect(canGroupAction(member, group, "member.add")).toBe(false);
    expect(canGroupAction(member, group, "expense.create")).toBe(true);
    expect(canGroupAction(member, group, "recurring.create")).toBe(true);
    expect(canGroupAction(member, group, "import")).toBe(false);
    expect(canGroupAction(member, group, "group.settings.update")).toBe(false);
  });

  it("does not let the site-wide app-admin role grant group permissions", () => {
    const appAdmin = { id: "other", role: "admin" };
    expect(canGroupAction(appAdmin, group, "group.settings.update")).toBe(false);
    expect(canGroupAction(appAdmin, group, "import")).toBe(false);
  });

  it("limits members to editing and deleting their own expenses and recurring expenses", () => {
    const member = { id: "member" };
    for (const type of ["expense.update", "expense.delete", "recurring.update", "recurring.delete"] as const) {
      expect(canGroupAction(member, group, { type, ownerId: "member" })).toBe(true);
      expect(canGroupAction(member, group, { type, ownerId: "other" })).toBe(false);
    }
  });

  it("allows group admins and creators to manage any expense and import", () => {
    for (const id of ["creator", "admin"]) {
      const user = { id };
      expect(canGroupAction(user, group, "member.add")).toBe(true);
      expect(canGroupAction(user, group, "import")).toBe(true);
      expect(canGroupAction(user, group, { type: "expense.update", ownerId: "other" })).toBe(true);
      expect(canGroupAction(user, group, { type: "recurring.delete", ownerId: "other" })).toBe(true);
    }
  });

  it("limits members to recording settlements for their own debts", () => {
    const member = { id: "member" };
    expect(canGroupAction(member, group, { type: "settlement.create", debtorId: "member" })).toBe(true);
    expect(canGroupAction(member, group, { type: "settlement.create", debtorId: "other" })).toBe(false);
    expect(canGroupAction(member, group, { type: "settlement.delete", recorderId: "other" })).toBe(false);
    expect(canGroupAction(member, group, { type: "settlement.delete", recorderId: "member" })).toBe(true);
    expect(canGroupAction({ id: "admin" }, group, { type: "settlement.create", debtorId: "other" })).toBe(true);
  });

  it("allows members to leave but not remove someone else", () => {
    const member = { id: "member" };
    expect(canGroupAction(member, group, { type: "member.remove", targetUserId: "member" })).toBe(true);
    expect(canGroupAction(member, group, { type: "member.remove", targetUserId: "other" })).toBe(false);
    expect(canGroupAction({ id: "creator" }, group, { type: "member.remove", targetUserId: "creator" })).toBe(false);
  });

  it("lets admins change non-creator roles, while only the creator can transfer creator", () => {
    expect(canGroupAction({ id: "admin" }, group, {
      type: "member.role.change",
      targetUserId: "other",
      role: GroupRole.Admin,
    })).toBe(true);
    expect(canGroupAction({ id: "admin" }, group, {
      type: "member.role.change",
      targetUserId: "other",
      role: GroupRole.Creator,
    })).toBe(false);
    expect(canGroupAction({ id: "creator" }, group, {
      type: "member.role.change",
      targetUserId: "other",
      role: GroupRole.Creator,
    })).toBe(true);
    expect(canGroupAction({ id: "admin" }, group, {
      type: "member.role.change",
      targetUserId: "creator",
      role: GroupRole.Member,
    })).toBe(false);
  });

  it("restricts group deletion to the group creator", () => {
    expect(canGroupAction({ id: "creator" }, group, "group.delete")).toBe(true);
    expect(canGroupAction({ id: "admin" }, group, "group.delete")).toBe(false);
  });
});
