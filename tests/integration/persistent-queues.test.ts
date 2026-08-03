import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QueuedGenerationService } from "@lyra/core";
import {
  AgentRunRepository,
  JobRepository,
  LyraDatabase,
  ProviderRepository,
  RuntimeEventRepository
} from "@lyra/storage";
import { insertQueuedAgentRun, prepareM4Database } from "../fixtures/m4-database.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("persistent execution queues", () => {
  it("atomically claims a job once and keeps retry history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lyra-job-queue-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "lyra.sqlite3");
    const firstDatabase = new LyraDatabase(databasePath);
    const secondDatabase = new LyraDatabase(databasePath);
    try {
      const seed = prepareM4Database(firstDatabase);
      const firstJobs = new JobRepository(firstDatabase);
      const secondJobs = new JobRepository(secondDatabase);
      const generations = new QueuedGenerationService(firstJobs);
      const providers = new ProviderRepository(firstDatabase);
      const retryProfile = providers.createProfile({
        id: "retry-provider",
        serviceType: "image",
        name: "Retry provider",
        protocol: "openai-compatible",
        baseUrl: "https://retry.example/v1",
        apiKeyEnvironmentVariable: "LYRA_RETRY_PROVIDER_KEY"
      });
      const retryModel = providers.createModel(retryProfile.id, {
        id: "retry-model",
        serviceType: "image",
        remoteModelId: "retry-image",
        displayName: "Retry image"
      });
      const submitted = generations.submit({
        projectId: seed.projectId,
        prompt: "generate test image",
        attachments: [],
        providerProfileId: seed.providerProfileId,
        providerModelId: seed.imageModelId,
        count: 1,
        parameters: {},
        source: "manual"
      });

      const claimedByFirst = firstJobs.claimNext("worker-a");
      const claimedBySecond = secondJobs.claimNext("worker-b");
      expect(claimedByFirst).toMatchObject({ id: submitted.id, lockedBy: "worker-a" });
      expect(claimedBySecond).toBeNull();

      const failed = firstJobs.fail(submitted.id, "worker-a", "TEST_FAILURE", "failed");
      const retried = secondJobs.retry(failed.id, {
        providerProfileId: retryProfile.id,
        providerModelId: retryModel.id
      });
      expect(retried).toMatchObject({
        status: "queued",
        attempt: 2,
        retryOfJobId: failed.id,
        providerProfileId: retryProfile.id,
        providerModelId: retryModel.id,
        providerName: "Retry provider",
        remoteModelId: "retry-image"
      });
      expect(retried.id).not.toBe(failed.id);
      expect(firstJobs.findById(failed.id)).toMatchObject({
        status: "failed",
        attempt: 1,
        dismissedAt: expect.any(String)
      });
      expect(firstJobs.list({ projectId: seed.projectId })).toEqual([
        expect.objectContaining({ id: retried.id })
      ]);

      const events = new RuntimeEventRepository(secondDatabase).list({
        projectId: seed.projectId
      });
      expect(events.map((event) => event.type)).toEqual([
        "job.created",
        "job.updated",
        "job.failed",
        "job.created",
        "job.dismissed"
      ]);
    } finally {
      secondDatabase.close();
      firstDatabase.close();
    }
  });

  it("interrupts stale jobs and keeps waiting Agent runs out of the runnable queue", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lyra-agent-queue-"));
    temporaryDirectories.push(directory);
    const database = new LyraDatabase(join(directory, "lyra.sqlite3"));
    try {
      const seed = prepareM4Database(database);
      const jobs = new JobRepository(database);
      const generation = new QueuedGenerationService(jobs);
      const job = generation.submit({
        projectId: seed.projectId,
        prompt: "stale job",
        attachments: [],
        providerProfileId: seed.providerProfileId,
        providerModelId: seed.imageModelId,
        count: 1,
        parameters: {},
        source: "manual"
      });
      jobs.claimNext("dead-worker");
      database.connection
        .prepare("UPDATE jobs SET locked_at = ? WHERE id = ?")
        .run("2000-01-01T00:00:00.000Z", job.id);
      expect(jobs.recoverStale("2001-01-01T00:00:00.000Z")).toHaveLength(1);
      expect(jobs.findById(job.id)).toMatchObject({ status: "interrupted" });
      expect(jobs.dismissFailed(seed.projectId)).toBe(1);
      expect(jobs.list({ projectId: seed.projectId })).toEqual([]);

      insertQueuedAgentRun(database, seed, "agent-run-1");
      const agentRuns = new AgentRunRepository(database);
      expect(agentRuns.claimNext("agent-worker-a")).toMatchObject({
        id: "agent-run-1",
        status: "thinking",
        lockedBy: "agent-worker-a"
      });
      expect(agentRuns.claimNext("agent-worker-b")).toBeNull();
      expect(agentRuns.releaseWaiting("agent-run-1", "agent-worker-a", "waiting_tool")).toMatchObject({
        status: "waiting_tool"
      });
      expect(agentRuns.claimNext("agent-worker-b")).toBeNull();
    } finally {
      database.close();
    }
  });
});
