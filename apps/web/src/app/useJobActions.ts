import type {
  Dispatch,
  SetStateAction
} from "react";
import type {
  JobSnapshot,
  ProviderModelSnapshot
} from "@lyra/contracts";
import type { ApiClient } from "../lib/api-client.js";

interface UseJobActionsOptions {
  api: ApiClient;
  projectId: string;
  selectedImageModel: ProviderModelSnapshot | undefined;
  setJobs: Dispatch<SetStateAction<JobSnapshot[]>>;
  refreshProject: (projectId: string) => Promise<void>;
  onError: (error: unknown) => void;
}

export function useJobActions(options: UseJobActionsOptions) {
  async function cancelJob(jobId: string) {
    try {
      await options.api.cancelJob(jobId);
      await options.refreshProject(options.projectId);
    } catch (error) {
      options.onError(error);
    }
  }

  async function retryJob(jobId: string) {
    try {
      await options.api.retryJob(
        jobId,
        options.selectedImageModel
          ? {
              providerProfileId: options.selectedImageModel.providerProfileId,
              providerModelId: options.selectedImageModel.id
            }
          : undefined
      );
      await options.refreshProject(options.projectId);
    } catch (error) {
      options.onError(error);
    }
  }

  async function dismissJob(jobId: string) {
    try {
      await options.api.dismissJob(jobId);
      options.setJobs((current) =>
        current.filter((job) => job.id !== jobId)
      );
    } catch (error) {
      options.onError(error);
    }
  }

  async function clearFailedJobs() {
    if (!options.projectId) return;
    try {
      await options.api.clearFailedJobs(options.projectId);
      options.setJobs(removeTerminalFailureJobs);
    } catch (error) {
      options.onError(error);
    }
  }

  return {
    cancelJob,
    retryJob,
    dismissJob,
    clearFailedJobs
  };
}

export function removeTerminalFailureJobs(
  jobs: JobSnapshot[]
): JobSnapshot[] {
  return jobs.filter(
    (job) =>
      job.status !== "failed" &&
      job.status !== "cancelled" &&
      job.status !== "interrupted"
  );
}
