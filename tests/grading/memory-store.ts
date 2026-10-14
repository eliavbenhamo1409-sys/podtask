import type { GradingStore, NewRun, PersistArgs, StoredRun } from "../../supabase/functions/_shared/grading/pipeline.ts";
import type { InterviewBundle, QuestionEvaluation } from "../../supabase/functions/_shared/grading/types.ts";

/** In-memory `GradingStore` with the same semantics as the SQL RPCs. */
export class MemoryStore implements GradingStore {
  bundles = new Map<string, InterviewBundle>();
  runs: Array<StoredRun & { interviewId: string; jobId: string | null; error: string | null }> = [];
  persisted: PersistArgs[] = [];
  checkpoints = 0;
  failures: string[] = [];

  constructor(bundles: InterviewBundle[] = []) {
    for (const b of bundles) this.bundles.set(b.interviewId, b);
  }

  loadBundle(interviewId: string): Promise<InterviewBundle | null> {
    return Promise.resolve(this.bundles.get(interviewId) ?? null);
  }

  findReusableRun(interviewId: string, inputHash: string): Promise<StoredRun | null> {
    const r = [...this.runs].reverse().find((x) => x.interviewId === interviewId && x.inputHash === inputHash && x.status === "succeeded");
    return Promise.resolve(r ?? null);
  }

  findResumableRun(interviewId: string, inputHash: string): Promise<StoredRun | null> {
    const r = [...this.runs].reverse().find((x) => x.interviewId === interviewId && x.inputHash === inputHash && x.status === "running");
    return Promise.resolve(r ?? null);
  }

  createRun(run: NewRun): Promise<{ id: string; runNo: number }> {
    for (const r of this.runs) if (r.interviewId === run.interviewId && r.status === "running") r.status = "superseded";
    const runNo = this.runs.filter((r) => r.interviewId === run.interviewId).length + 1;
    const id = `run-${run.interviewId.slice(0, 4)}-${runNo}`;
    this.runs.push({ id, runNo, status: "running", inputHash: run.inputHash, evaluations: [], result: null, narrative: null, interviewId: run.interviewId, jobId: run.jobId, error: null });
    return Promise.resolve({ id, runNo });
  }

  checkpoint(runId: string, evaluations: QuestionEvaluation[]): Promise<void> {
    const r = this.runs.find((x) => x.id === runId);
    if (r && r.status === "running") r.evaluations = structuredClone(evaluations);
    this.checkpoints += 1;
    return Promise.resolve();
  }

  persistResult(args: PersistArgs): Promise<void> {
    const r = this.runs.find((x) => x.id === args.runId);
    if (!r) throw new Error("grading_run_not_found");
    if (r.status === "superseded") throw new Error("persist_refused:superseded");
    r.status = "succeeded";
    r.result = args.final;
    r.narrative = args.narrative;
    r.evaluations = structuredClone(args.evaluations);
    this.persisted.push(args);
    return Promise.resolve();
  }

  failRun(runId: string, error: string): Promise<void> {
    const r = this.runs.find((x) => x.id === runId);
    if (r && r.status === "running") {
      r.status = "failed";
      r.error = error;
    }
    this.failures.push(error);
    return Promise.resolve();
  }
}
