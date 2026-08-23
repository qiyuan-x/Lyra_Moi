import type { JobSnapshot } from "@lyra/contracts";
import { useEffect, useState } from "react";
import { formatDuration, isActiveJob, jobElapsedMs } from "./job-display.js";

export function JobElapsedTime(props: { job: JobSnapshot }) {
  const active = isActiveJob(props.job);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const elapsed = formatDuration(jobElapsedMs(props.job, now));
  return <time className="job-elapsed-time">耗时 {elapsed}</time>;
}
