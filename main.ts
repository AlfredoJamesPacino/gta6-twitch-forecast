import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Point = { from: string; viewers: number; channels?: number | null };
type Comparable = {
  name: string;
  day_start: string;
  unlock?: string;
  platforms?: string;
  hourly: Point[];
};
type Case = {
  id: string;
  levels: number[];
  day_start: string;
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
  game: { name: string };
  notes?: string;
};

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.645, -0.674, 0, 0.674, 1.645];

function quantile(items: Array<{ x: number; w: number }>, p: number): number {
  const a = items.filter(v => Number.isFinite(v.x) && v.w > 0).sort((u, v) => u.x - v.x);
  if (!a.length) return 0;
  const total = a.reduce((s, v) => s + v.w, 0);
  const at = p * total;
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    const prev = acc;
    acc += a[i].w;
    if (acc >= at) {
      if (i === 0 || a[i].w === 0) return a[i].x;
      const f = Math.max(0, Math.min(1, (at - prev) / a[i].w));
      const left = i === 0 ? a[i].x : a[i - 1].x;
      return left + (a[i].x - left) * f;
    }
  }
  return a[a.length - 1].x;
}

function launchCurve(event: Comparable): Array<number | null> {
  const start = Date.parse(event.day_start);
  const bins = new Map<number, number>();
  for (const p of event.hourly ?? []) {
    const h = Math.round((Date.parse(p.from) - start) / 3_600_000);
    if (h >= 0 && h < 24 && Number.isFinite(p.viewers) && p.viewers > 0) bins.set(h, p.viewers);
  }
  if (!bins.has(0)) return Array(24).fill(null);
  const known = [...bins.entries()].sort((a, b) => a[0] - b[0]);
  const curve: Array<number | null> = Array(24).fill(null);
  for (let h = 0; h < 24; h++) {
    if (bins.has(h)) { curve[h] = bins.get(h)!; continue; }
    let lo: [number, number] | undefined, hi: [number, number] | undefined;
    for (const pair of known) {
      if (pair[0] < h) lo = pair;
      if (pair[0] > h) { hi = pair; break; }
    }
    if (lo && hi && hi[0] - lo[0] <= 4) {
      const t = (h - lo[0]) / (hi[0] - lo[0]);
      curve[h] = Math.exp(Math.log(lo[1]) * (1 - t) + Math.log(hi[1]) * t);
    }
  }
  return curve;
}

function eventWeight(event: Comparable, c: Case, p1: number): number {
  const info = `${event.unlock ?? ''} ${event.platforms ?? ''}`.toLowerCase();
  if (!info.includes('tier: comparable') || info.includes('not a launch')) return 0;
  if (info.includes('early-access-contaminated') || info.includes('free-to-play')) return 0;
  if (event.name.toLowerCase().includes('grand theft auto vi category before release')) return 0;

  const platforms = (event.platforms ?? '').toLowerCase();
  let w = 1;
  const target = `${c.notes ?? ''} ${c.game?.name ?? ''}`.toLowerCase();
  if (/ps5|xbox|switch|console/.test(platforms)) w *= 1.35;
  else w *= 0.58;
  if (/ps5/.test(target) && /ps5/.test(platforms)) w *= 1.18;
  if (/xbox/.test(target) && /xbox/.test(platforms)) w *= 1.15;
  if (/midnight local|rolling/.test(info)) w *= 1.55;
  if (/simultaneous|single global/.test(info)) w *= 0.55;
  if (/weak analogue|weak\b/.test(info)) w *= 0.68;

  const year = new Date(event.day_start).getUTCFullYear();
  w *= year >= 2025 ? 1.35 : year >= 2023 ? 1.18 : year < 2020 ? 0.72 : 1;
  const size = Math.max(1, (launchCurve(event)[0] ?? p1));
  const sizeGap = Math.abs(Math.log(Math.max(1, p1) / size));
  w *= Math.exp(-0.12 * Math.min(8, sizeGap));

  const name = event.name.toLowerCase();
  if (/grand theft auto|red dead|cyberpunk|ghost of|hogwarts|assassin/.test(name)) w *= 1.2;
  if (/call of duty|battlefield|marathon/.test(name)) w *= 0.86;
  return w;
}

function predict(c: Case, h: number, p1: number): number[] {
  const samples: Array<{ x: number; w: number }> = [];
  for (const event of c.comparables ?? []) {
    const curve = launchCurve(event);
    const base = curve[0];
    const future = curve[h - 1];
    if (!base || !future) continue;
    const w = eventWeight(event, c, p1);
    if (w > 0) samples.push({ x: Math.log(future / base), w });
  }

  if (samples.length < 4) {
    const spread = 0.15 * Math.sqrt(h - 1);
    return Z.map(z => Math.max(1, p1 * Math.exp(z * spread)));
  }

  const empirical = LEVELS.map(level => quantile(samples, level));
  const median = empirical[2];
  const deviations = samples.map(v => ({ x: Math.abs(v.x - median), w: v.w }));
  const mad = Math.max(0.08, quantile(deviations, 0.5) * 1.4826);
  const logSpread = 0.22 * Math.sqrt(h - 1) + 0.78 * mad;
  const normal = Z.map(z => median + z * logSpread);
  const logs = empirical.map((v, i) => v * 0.68 + normal[i] * 0.32);
  return logs.map(v => Math.max(1, Math.min(1e9, p1 * Math.exp(v))));
}

mkdirSync(OUT, { recursive: true });
const files = readdirSync(IN).filter(f => f.endsWith('.in')).sort();
for (const file of files) {
  const c = JSON.parse(readFileSync(join(IN, file), 'utf8')) as Case;
  if (c.levels.length !== 5 || c.levels.some((x, i) => x !== LEVELS[i])) throw new Error(`Unexpected quantile levels in ${file}`);
  const first = c.known.find(k => k.hour === 1);
  if (!first) throw new Error(`No hour-1 print in ${file}`);
  const p1 = Math.max(1, first.viewers);
  const hours = c.forecast.map(({ hour }) => ({ hour, q: predict(c, hour, p1) }));
  writeFileSync(join(OUT, `${c.id}.out`), `${JSON.stringify({ hours })}\n`);
}
