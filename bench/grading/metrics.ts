/**
 * Metrics for the grading benchmark. Plain functions over number arrays so
 * they are trivially checkable.
 */

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

export function stddev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function mae(pred: number[], truth: number[]): number {
  const n = Math.min(pred.length, truth.length);
  if (!n) return NaN;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(pred[i] - truth[i]);
  return s / n;
}

/**
 * ICC(2,1): two-way random effects, absolute agreement, single rater.
 * `ratings[subject][rater]`, every subject rated by every rater.
 * Used both for repeat-run stability (raters = runs) and for model-vs-human
 * agreement (raters = [model, lecturer]).
 */
export function icc2_1(ratings: number[][]): number {
  const n = ratings.length;
  const k = ratings[0]?.length ?? 0;
  if (n < 2 || k < 2) return NaN;
  const grand = mean(ratings.flat());
  const subjectMeans = ratings.map(mean);
  const raterMeans = Array.from({ length: k }, (_, j) => mean(ratings.map((r) => r[j])));
  const msr = (k * subjectMeans.reduce((s, m) => s + (m - grand) ** 2, 0)) / (n - 1);
  const msc = (n * raterMeans.reduce((s, m) => s + (m - grand) ** 2, 0)) / (k - 1);
  let sse = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      sse += (ratings[i][j] - subjectMeans[i] - raterMeans[j] + grand) ** 2;
    }
  }
  const mse = sse / ((n - 1) * (k - 1));
  const denom = msr + (k - 1) * mse + (k * (msc - mse)) / n;
  return denom === 0 ? NaN : (msr - mse) / denom;
}

/** Share of (case, run-pair) combinations where a pass/fail decision at `threshold` flipped. */
export function flipRate(runsPerCase: number[][], threshold = 50): number {
  let pairs = 0;
  let flips = 0;
  for (const runs of runsPerCase) {
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        pairs += 1;
        if (runs[i] >= threshold !== runs[j] >= threshold) flips += 1;
      }
    }
  }
  return pairs ? flips / pairs : 0;
}

export function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
