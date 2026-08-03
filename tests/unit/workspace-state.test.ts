import { describe, expect, it } from "vitest";
import type {
  AssetSnapshot,
  ConversationSnapshot,
  JobSnapshot,
  ProjectSnapshot
} from "@lyra/contracts";
import { prependConversation } from "../../apps/web/src/app/useConversationWorkspace.js";
import {
  addUniqueAsset,
  prependUniqueAssets,
  removeAsset,
  replaceAsset,
  toggleSelectedAsset
} from "../../apps/web/src/app/useAssetWorkspace.js";
import { removeTerminalFailureJobs } from "../../apps/web/src/app/useJobActions.js";
import { removeProject } from "../../apps/web/src/app/useProjectActions.js";

describe("workspace state helpers", () => {
  it("keeps attachment IDs unique and supports toggle", () => {
    const first = asset("first");
    const second = asset("second");
    expect(addUniqueAsset([first], first)).toEqual([first]);
    expect(toggleSelectedAsset([first], second)).toEqual([first, second]);
    expect(toggleSelectedAsset([first, second], first)).toEqual([second]);
  });

  it("puts uploaded assets first and replaces existing snapshots", () => {
    const first = asset("first", "旧名称");
    const second = asset("second");
    const updated = asset("first", "新名称");
    expect(prependUniqueAssets([first], [second, updated]))
      .toEqual([second, updated]);
    expect(replaceAsset([first, second], updated))
      .toEqual([updated, second]);
    expect(removeAsset([updated, second], "first")).toEqual([second]);
  });

  it("deduplicates repeated uploads in one batch", () => {
    const first = asset("first");
    expect(prependUniqueAssets([], [first, first])).toEqual([first]);
  });

  it("moves the active conversation to the beginning without duplication", () => {
    const first = conversation("first");
    const second = conversation("second");
    const renamed = {
      ...second,
      title: "新标题"
    };
    expect(prependConversation([first, second], renamed))
      .toEqual([renamed, first]);
  });

  it("selects the next project only when the current project is removed", () => {
    const projects = [project("one"), project("two")];
    expect(removeProject(projects, "one", "one")).toEqual({
      projects: [projects[1]],
      projectId: "two"
    });
    expect(removeProject(projects, "one", "two")).toEqual({
      projects: [projects[0]],
      projectId: "one"
    });
  });

  it("removes only terminal failure job records", () => {
    const jobs = [
      job("queued", "queued"),
      job("failed", "failed"),
      job("cancelled", "cancelled"),
      job("interrupted", "interrupted"),
      job("succeeded", "succeeded")
    ];
    expect(removeTerminalFailureJobs(jobs).map((item) => item.id))
      .toEqual(["queued", "succeeded"]);
  });
});

function asset(id: string, name = id): AssetSnapshot {
  return { id, name } as AssetSnapshot;
}

function project(id: string): ProjectSnapshot {
  return { id } as ProjectSnapshot;
}

function conversation(id: string): ConversationSnapshot {
  return { id, title: id } as ConversationSnapshot;
}

function job(id: string, status: JobSnapshot["status"]): JobSnapshot {
  return { id, status } as JobSnapshot;
}
