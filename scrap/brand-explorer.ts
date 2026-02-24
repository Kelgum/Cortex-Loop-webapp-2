// ─── Brand Terminology Explorer — Semantic Affinity Engine v3 ─────────────────
// Lens-driven: switch between dimension groups (Brand Voice, Industry, Channel, Tone).
// Each lens provides 6 sliders that map to the underlying Brand Voice space.
// All unlocked word axes auto-resolve to the best match for the computed target voice.

type Vec6 = [number, number, number, number, number, number];

// Brand Voice dimension names (the underlying semantic space)
const VOICE_DIM_NAMES = ['Media', 'Tech', 'Gaming', 'Clinical', 'Craft', 'Performance'] as const;
const VOICE_DIM_COLORS = ['#3b82f6', '#06b6d4', '#a855f7', '#ef4444', '#f59e0b', '#22c55e'];

// ─── Math ────────────────────────────────────────────────────────────────────

function dot(a: Vec6, b: Vec6): number {
  let s = 0; for (let i = 0; i < 6; i++) s += a[i] * b[i]; return s;
}
function magnitude(v: Vec6): number { return Math.sqrt(dot(v, v)); }
function cosine(a: Vec6, b: Vec6): number {
  const ma = magnitude(a), mb = magnitude(b);
  return (ma === 0 || mb === 0) ? 0 : dot(a, b) / (ma * mb);
}
function vecAvg(vecs: Vec6[]): Vec6 {
  if (!vecs.length) return [0, 0, 0, 0, 0, 0];
  const s: Vec6 = [0, 0, 0, 0, 0, 0];
  for (const v of vecs) for (let i = 0; i < 6; i++) s[i] += v[i];
  return s.map(x => x / vecs.length) as Vec6;
}

// ─── Lens System ──────────────────────────────────────────────────────────────

interface LensDimension {
  name: string;
  color: string;
  mapping: Vec6; // how this dimension projects into Brand Voice space
}

interface Lens {
  id: string;
  label: string;
  description: string;
  dimensions: LensDimension[];
}

const LENSES: Lens[] = [
  {
    id: 'voice', label: 'Brand Voice', description: 'Raw semantic dimensions — direct control',
    dimensions: [
      { name: 'Media',       color: '#3b82f6', mapping: [1, 0, 0, 0, 0, 0] },
      { name: 'Tech',        color: '#06b6d4', mapping: [0, 1, 0, 0, 0, 0] },
      { name: 'Gaming',      color: '#a855f7', mapping: [0, 0, 1, 0, 0, 0] },
      { name: 'Clinical',    color: '#ef4444', mapping: [0, 0, 0, 1, 0, 0] },
      { name: 'Craft',       color: '#f59e0b', mapping: [0, 0, 0, 0, 1, 0] },
      { name: 'Performance', color: '#22c55e', mapping: [0, 0, 0, 0, 0, 1] },
    ],
  },
  {
    id: 'industry', label: 'Industry', description: 'What sector does your brand live in?',
    dimensions: [
      { name: 'Healthcare',    color: '#ef4444', mapping: [0.2, 0.2, 0.0, 0.7, 0.3, 0.6] },
      { name: 'Consumer Tech', color: '#3b82f6', mapping: [0.7, 0.8, 0.3, 0.0, 0.4, 0.2] },
      { name: 'Enterprise',    color: '#06b6d4', mapping: [0.1, 0.9, 0.1, 0.1, 0.2, 0.3] },
      { name: 'Pharma',        color: '#a855f7', mapping: [0.0, 0.5, 0.0, 0.9, 0.1, 0.3] },
      { name: 'Fitness',       color: '#22c55e', mapping: [0.3, 0.2, 0.4, 0.1, 0.2, 0.9] },
      { name: 'Creator',       color: '#f59e0b', mapping: [0.8, 0.3, 0.5, 0.0, 0.7, 0.1] },
    ],
  },
  {
    id: 'channel', label: 'Channel', description: 'How do you reach your users?',
    dimensions: [
      { name: 'B2C',          color: '#3b82f6', mapping: [0.8, 0.2, 0.5, 0.1, 0.6, 0.3] },
      { name: 'B2B',          color: '#06b6d4', mapping: [0.1, 0.8, 0.1, 0.2, 0.1, 0.7] },
      { name: 'D2C',          color: '#f59e0b', mapping: [0.7, 0.3, 0.3, 0.0, 0.9, 0.2] },
      { name: 'Marketplace',  color: '#a855f7', mapping: [0.6, 0.4, 0.3, 0.1, 0.5, 0.2] },
      { name: 'Clinical/Rx',  color: '#ef4444', mapping: [0.0, 0.3, 0.0, 0.9, 0.1, 0.4] },
      { name: 'Retail',       color: '#22c55e', mapping: [0.5, 0.2, 0.2, 0.1, 0.4, 0.5] },
    ],
  },
  {
    id: 'tone', label: 'Brand Tone', description: 'What personality should your brand convey?',
    dimensions: [
      { name: 'Professional', color: '#06b6d4', mapping: [0.1, 0.7, 0.0, 0.3, 0.2, 0.5] },
      { name: 'Playful',      color: '#a855f7', mapping: [0.7, 0.2, 0.8, 0.0, 0.4, 0.3] },
      { name: 'Scientific',   color: '#ef4444', mapping: [0.0, 0.6, 0.0, 0.8, 0.1, 0.3] },
      { name: 'Aspirational', color: '#f59e0b', mapping: [0.5, 0.3, 0.4, 0.0, 0.3, 0.7] },
      { name: 'Technical',    color: '#3b82f6', mapping: [0.0, 0.9, 0.2, 0.2, 0.1, 0.2] },
      { name: 'Accessible',   color: '#22c55e', mapping: [0.6, 0.1, 0.3, 0.1, 0.7, 0.2] },
    ],
  },
];

// ─── Mapping Functions ────────────────────────────────────────────────────────

function getCurrentLens(): Lens {
  return LENSES.find(l => l.id === currentLensId)!;
}

/** Lens slider values → Brand Voice space (weighted sum, clamped) */
function forwardMap(lens: Lens, values: number[]): Vec6 {
  const result: Vec6 = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) {
    const m = lens.dimensions[i].mapping;
    for (let j = 0; j < 6; j++) {
      result[j] += values[i] * m[j];
    }
  }
  return result.map(v => Math.min(Math.max(v, 0), 1)) as Vec6;
}

/** Brand Voice → lens slider values (projection onto each mapping vector) */
function reverseMap(lens: Lens, voice: Vec6): number[] {
  return lens.dimensions.map(dim => {
    const m = dim.mapping;
    const magSq = dot(m, m);
    if (magSq < 0.001) return 0;
    const proj = dot(voice, m) / magSq;
    return Math.min(Math.max(proj, 0), 1);
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TermOption { label: string; sem: Vec6; }
interface Axis { id: string; label: string; group: string; termClass: string; options: TermOption[]; }
interface AxisState { selected: number; locked: boolean; }

// ─── Taxonomy Database ────────────────────────────────────────────────────────
//                                          media  tech  game  clin  craft  perf

const AXES: Axis[] = [
  { id: 'step1', label: 'Step 1 Verb', group: 'The 3-Step Flow', termClass: 't-verb', options: [
    { label: 'Design',    sem: [0.4, 0.3, 0.1, 0.0, 0.9, 0.0] },
    { label: 'Configure', sem: [0.1, 0.9, 0.4, 0.1, 0.2, 0.0] },
    { label: 'Create',    sem: [0.5, 0.2, 0.2, 0.0, 0.8, 0.1] },
    { label: 'Build',     sem: [0.1, 0.6, 0.3, 0.0, 0.7, 0.3] },
  ]},
  { id: 'step2', label: 'Step 2 Verb', group: 'The 3-Step Flow', termClass: 't-verb', options: [
    { label: 'Stream',   sem: [1.0, 0.3, 0.2, 0.0, 0.1, 0.0] },
    { label: 'Compile',  sem: [0.0, 1.0, 0.0, 0.1, 0.1, 0.0] },
    { label: 'Activate', sem: [0.1, 0.2, 0.6, 0.4, 0.0, 0.5] },
    { label: 'Transmit', sem: [0.5, 0.6, 0.0, 0.1, 0.0, 0.0] },
  ]},
  { id: 'step3', label: 'Step 3 Verb', group: 'The 3-Step Flow', termClass: 't-verb', options: [
    { label: 'Play',    sem: [0.7, 0.1, 0.9, 0.0, 0.0, 0.3] },
    { label: 'Stream',  sem: [1.0, 0.2, 0.1, 0.0, 0.0, 0.0] },
    { label: 'Execute', sem: [0.0, 0.9, 0.1, 0.2, 0.0, 0.3] },
    { label: 'Dose',    sem: [0.0, 0.0, 0.0, 1.0, 0.0, 0.2] },
  ]},
  { id: 'platform', label: 'Platform / App', group: 'Product Ecosystem', termClass: 't-product', options: [
    { label: 'Protocol Studio',  sem: [0.5, 0.2, 0.0, 0.3, 0.8, 0.0] },
    { label: 'Design Studio',    sem: [0.4, 0.1, 0.0, 0.0, 1.0, 0.0] },
    { label: 'Lx Studio',        sem: [0.5, 0.3, 0.0, 0.2, 0.7, 0.0] },
    { label: 'The Studio',       sem: [0.6, 0.1, 0.0, 0.0, 0.9, 0.0] },
  ]},
  { id: 'fulfillment', label: 'Fulfillment / Factory', group: 'Product Ecosystem', termClass: 't-product', options: [
    { label: 'The Hive',             sem: [0.2, 0.5, 0.2, 0.1, 0.3, 0.1] },
    { label: 'Protocol Compiler',    sem: [0.0, 1.0, 0.0, 0.2, 0.1, 0.0] },
    { label: 'Protocol Streaming',   sem: [0.9, 0.2, 0.1, 0.1, 0.1, 0.0] },
    { label: 'Protocol Activation',  sem: [0.1, 0.2, 0.5, 0.5, 0.0, 0.3] },
  ]},
  { id: 'device', label: 'Hardware Device', group: 'Product Ecosystem', termClass: 't-product', options: [
    { label: 'Protocol Player',   sem: [0.6, 0.2, 0.8, 0.1, 0.0, 0.2] },
    { label: 'Protocol Streamer', sem: [1.0, 0.1, 0.1, 0.0, 0.0, 0.0] },
    { label: 'Lx Player',         sem: [0.5, 0.2, 0.7, 0.1, 0.0, 0.2] },
    { label: 'The Device',        sem: [0.1, 0.7, 0.1, 0.4, 0.0, 0.1] },
  ]},
  { id: 'cartridge', label: 'Cartridge', group: 'Product Ecosystem', termClass: 't-cartridge', options: [
    { label: 'dose.cartridge',     sem: [0.2, 0.5, 0.0, 0.8, 0.0, 0.2] },
    { label: 'protocol.cartridge', sem: [0.2, 0.6, 0.0, 0.4, 0.1, 0.1] },
    { label: 'Lx.cartridge',       sem: [0.3, 0.4, 0.0, 0.3, 0.1, 0.1] },
    { label: 'smart.cartridge',    sem: [0.2, 0.7, 0.1, 0.3, 0.0, 0.1] },
  ]},
  { id: 'user', label: 'User / Creator Archetype', group: 'People & Content', termClass: 't-user', options: [
    { label: 'Protocol Creator',   sem: [0.4, 0.2, 0.1, 0.3, 0.7, 0.1] },
    { label: 'Content Creator',    sem: [0.9, 0.0, 0.2, 0.0, 0.6, 0.0] },
    { label: 'Protocol Designer',  sem: [0.2, 0.4, 0.0, 0.3, 0.9, 0.0] },
    { label: 'Performance Expert', sem: [0.1, 0.1, 0.1, 0.3, 0.2, 0.9] },
  ]},
  { id: 'output', label: 'The Output / Content', group: 'People & Content', termClass: 't-output', options: [
    { label: 'Protocol', sem: [0.3, 0.4, 0.1, 0.6, 0.2, 0.2] },
    { label: 'Stack',    sem: [0.2, 0.7, 0.1, 0.3, 0.3, 0.3] },
    { label: 'Program',  sem: [0.3, 0.8, 0.1, 0.0, 0.1, 0.5] },
    { label: 'Regimen',  sem: [0.0, 0.0, 0.0, 0.9, 0.1, 0.6] },
  ]},
  { id: 'creatorAction', label: 'Creator Marketplace Action', group: 'People & Content', termClass: 't-action', options: [
    { label: 'Publish', sem: [0.6, 0.2, 0.0, 0.1, 0.7, 0.0] },
    { label: 'Share',   sem: [0.5, 0.1, 0.1, 0.0, 0.5, 0.1] },
    { label: 'Stream',  sem: [1.0, 0.2, 0.1, 0.0, 0.1, 0.0] },
    { label: 'Deploy',  sem: [0.0, 0.9, 0.1, 0.1, 0.1, 0.1] },
  ]},
  { id: 'domain', label: 'Domain / Category', group: 'Brand Positioning', termClass: 't-domain', options: [
    { label: 'Peak Performance',          sem: [0.2, 0.2, 0.4, 0.1, 0.1, 0.9] },
    { label: 'Biological Optimization',   sem: [0.0, 0.5, 0.0, 0.6, 0.0, 0.5] },
    { label: 'Performance Optimization',  sem: [0.1, 0.6, 0.2, 0.1, 0.0, 0.8] },
    { label: 'Wellness',                  sem: [0.2, 0.1, 0.0, 0.6, 0.3, 0.5] },
  ]},
  { id: 'positioning', label: 'Positioning Frame', group: 'Brand Positioning', termClass: 't-position', options: [
    { label: 'The OS for',                sem: [0.3, 0.9, 0.2, 0.0, 0.1, 0.1] },
    { label: 'The Action Layer for',      sem: [0.2, 0.7, 0.3, 0.0, 0.0, 0.4] },
    { label: 'The Platform for',          sem: [0.5, 0.5, 0.2, 0.1, 0.2, 0.1] },
    { label: 'The Intelligence Layer for', sem: [0.1, 0.8, 0.0, 0.4, 0.0, 0.2] },
  ]},
  { id: 'intent', label: 'Intent Phrase', group: 'Brand Positioning', termClass: 't-intent', options: [
    { label: 'Intent \u2192 Intake',     sem: [0.2, 0.2, 0.0, 0.8, 0.1, 0.3] },
    { label: 'Intent \u2192 Action',     sem: [0.3, 0.3, 0.4, 0.1, 0.1, 0.6] },
    { label: 'Data \u2192 Action',       sem: [0.1, 0.8, 0.1, 0.2, 0.0, 0.3] },
    { label: 'Bio-Data \u2192 Bio-Intake', sem: [0.0, 0.5, 0.0, 0.9, 0.0, 0.3] },
  ]},
  { id: 'subscription', label: 'Subscription Model', group: 'Brand Positioning', termClass: 't-sub', options: [
    { label: 'Supplements-as-a-Service',  sem: [0.1, 0.3, 0.0, 0.8, 0.0, 0.3] },
    { label: 'Protocols-as-a-Service',    sem: [0.3, 0.5, 0.0, 0.4, 0.2, 0.2] },
    { label: 'Stacks-as-a-Service',       sem: [0.2, 0.7, 0.1, 0.2, 0.2, 0.3] },
    { label: 'Performance-as-a-Service',  sem: [0.2, 0.3, 0.2, 0.1, 0.1, 0.9] },
  ]},
];

// ─── State ────────────────────────────────────────────────────────────────────

let targetVoice: Vec6 = [0.40, 0.40, 0.25, 0.25, 0.35, 0.20];
let currentLensId = 'voice';
let lensSliderValues: number[] = [0.40, 0.40, 0.25, 0.25, 0.35, 0.20];
const axisState: Record<string, AxisState> = {};

function initState() {
  targetVoice = [0.40, 0.40, 0.25, 0.25, 0.35, 0.20];
  currentLensId = 'voice';
  lensSliderValues = [...targetVoice];
  for (const axis of AXES) axisState[axis.id] = { selected: 0, locked: false };
  cascadeFromSliders();
}

function val(id: string): string {
  const axis = AXES.find(a => a.id === id)!;
  return axis.options[axisState[id].selected]?.label ?? axis.options[0].label;
}
function valLower(id: string): string { return val(id).toLowerCase(); }
function selectedSem(id: string): Vec6 {
  const axis = AXES.find(a => a.id === id)!;
  return axis.options[axisState[id].selected]?.sem ?? [0,0,0,0,0,0];
}

// ─── Cascade Engine ───────────────────────────────────────────────────────────

let cascadedSet = new Set<string>();

function cascadeFromSliders(): Set<string> {
  const changed = new Set<string>();
  for (const axis of AXES) {
    if (axisState[axis.id].locked) continue;
    let bestIdx = axisState[axis.id].selected, bestScore = -Infinity;
    for (let i = 0; i < axis.options.length; i++) {
      const score = dot(axis.options[i].sem, targetVoice);
      if (score > bestScore || (score === bestScore && i === axisState[axis.id].selected)) {
        bestScore = score; bestIdx = i;
      }
    }
    if (bestIdx !== axisState[axis.id].selected) {
      axisState[axis.id].selected = bestIdx;
      changed.add(axis.id);
    }
  }
  return changed;
}

// ─── Voice & Coherence ────────────────────────────────────────────────────────

function computeActualVoice(): Vec6 {
  return vecAvg(AXES.map(a => selectedSem(a.id)));
}

function computeCoherence(): number {
  const vecs = AXES.map(a => selectedSem(a.id));
  let total = 0, count = 0;
  for (let i = 0; i < vecs.length; i++)
    for (let j = i + 1; j < vecs.length; j++) { total += cosine(vecs[i], vecs[j]); count++; }
  return count > 0 ? total / count : 0;
}

function dominantDims(voice: Vec6): string {
  const indexed = voice.map((v, i) => ({ v, name: VOICE_DIM_NAMES[i] }));
  indexed.sort((a, b) => b.v - a.v);
  const top = indexed.filter(d => d.v > 0.15).slice(0, 2);
  return top.length ? top.map(d => d.name).join(' + ') : 'Neutral';
}

// ─── Radar SVG ────────────────────────────────────────────────────────────────

function renderRadar(voice: Vec6, lens: Lens): string {
  const cx = 90, cy = 90, maxR = 70, n = 6;
  const pt = (d: number, r: number): [number, number] => {
    const a = (d / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  let svg = '';
  // Grid rings
  for (const p of [0.33, 0.66, 1]) {
    const pts = Array.from({length: n}, (_, i) => pt(i, maxR * p));
    svg += `<polygon points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#2a4040" stroke-width="0.5"/>`;
  }
  // Spokes
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i, maxR);
    svg += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#2a4040" stroke-width="0.5"/>`;
  }
  // Voice polygon — use lens slider values for non-identity, voice dims for identity
  const isIdentity = lens.id === 'voice';
  const displayValues = isIdentity ? voice : lensSliderValues;
  const mx = Math.max(...displayValues, 0.01);
  const vn = displayValues.map(v => v / mx);
  const vPts = vn.map((v, i) => pt(i, Math.max(v, 0.05) * maxR));
  svg += `<polygon points="${vPts.map(p=>p.join(',')).join(' ')}" fill="rgba(45,212,191,0.15)" stroke="#2dd4bf" stroke-width="1.5"/>`;
  // Dots and labels
  for (let i = 0; i < n; i++) {
    const dim = lens.dimensions[i];
    const [x, y] = vPts[i];
    svg += `<circle cx="${x}" cy="${y}" r="3" fill="${dim.color}" stroke="#0f1a1a" stroke-width="1"/>`;
    const [lx, ly] = pt(i, maxR + 14);
    const anc = lx < cx - 5 ? 'end' : lx > cx + 5 ? 'start' : 'middle';
    svg += `<text x="${lx}" y="${ly}" fill="${dim.color}" font-size="7.5" font-weight="700" text-anchor="${anc}" dominant-baseline="middle">${dim.name}</text>`;
  }
  return `<svg class="radar-svg" viewBox="0 0 180 180" width="160" height="160">${svg}</svg>`;
}

// ─── Voice Decomposition (shows Brand Voice breakdown when on non-identity lens) ──

function renderVoiceDecomp(): string {
  if (currentLensId === 'voice') return '';
  let html = `<div class="voice-decomp"><div class="voice-decomp-title">Brand Voice Decomposition</div>`;
  for (let i = 0; i < 6; i++) {
    const pct = Math.round(targetVoice[i] * 100);
    html += `
      <div class="voice-decomp-row">
        <div class="voice-decomp-dot" style="background:${VOICE_DIM_COLORS[i]}"></div>
        <span class="voice-decomp-name">${VOICE_DIM_NAMES[i]}</span>
        <div class="voice-decomp-bar"><div class="voice-decomp-fill" style="width:${pct}%;background:${VOICE_DIM_COLORS[i]}"></div></div>
        <span class="voice-decomp-val">${pct}%</span>
      </div>`;
  }
  html += '</div>';
  return html;
}

// ─── Controls Rendering ───────────────────────────────────────────────────────

function renderControls() {
  const el = document.getElementById('controls')!;
  el.innerHTML = '';
  const voice = computeActualVoice();
  const coherence = computeCoherence();
  const pct = Math.round(coherence * 100);
  const color = pct >= 70 ? '#22c55e' : pct >= 50 ? '#eab308' : '#ef4444';
  const desc = pct >= 70 ? 'Strong coherence' : pct >= 50 ? 'Moderate \u2014 some tension' : 'Semantic tension';
  const lens = getCurrentLens();

  // ── Coherence Banner ──
  const banner = document.createElement('div');
  banner.className = 'coherence-banner';
  banner.innerHTML = `
    <div class="coherence-label">Brand Coherence</div>
    <div class="coherence-bar-track"><div class="coherence-bar-fill" style="width:${pct}%;background:${color}"></div></div>
    <div class="coherence-row"><span class="coherence-value" style="color:${color}">${pct}%</span><span class="coherence-desc">${desc}</span></div>
    <div class="voice-label">Voice: ${dominantDims(voice)}</div>
  `;
  el.appendChild(banner);

  // ── Lens Tabs + Sliders Section ──
  const slidersDiv = document.createElement('div');
  slidersDiv.className = 'sliders-section';

  // Lens tabs
  const tabs = document.createElement('div');
  tabs.className = 'lens-tabs';
  for (const l of LENSES) {
    const tab = document.createElement('button');
    tab.className = `lens-tab ${l.id === currentLensId ? 'active' : ''}`;
    tab.textContent = l.label;
    tab.addEventListener('click', () => {
      if (l.id === currentLensId) return;
      switchLens(l.id);
    });
    tabs.appendChild(tab);
  }
  slidersDiv.appendChild(tabs);

  // Lens description
  const descDiv = document.createElement('div');
  descDiv.className = 'lens-desc';
  descDiv.textContent = lens.description;
  slidersDiv.appendChild(descDiv);

  // Sliders
  for (let d = 0; d < 6; d++) {
    const dim = lens.dimensions[d];
    const row = document.createElement('div');
    row.className = 'slider-row';
    const pctVal = Math.round(lensSliderValues[d] * 100);
    row.innerHTML = `
      <div class="slider-dim-dot" style="background:${dim.color}"></div>
      <span class="slider-dim-name">${dim.name}</span>
      <input type="range" class="slider-input" min="0" max="100" value="${pctVal}"
        id="slider-${d}" style="accent-color:${dim.color}">
      <span class="slider-val" id="slider-val-${d}" style="color:${dim.color}">${pctVal}%</span>
    `;
    slidersDiv.appendChild(row);

    const input = row.querySelector('input')!;
    input.addEventListener('input', () => {
      const v = parseInt((input as HTMLInputElement).value, 10) / 100;
      lensSliderValues[d] = v;
      // Forward map to Brand Voice
      targetVoice = forwardMap(lens, lensSliderValues);
      const valEl = document.getElementById(`slider-val-${d}`);
      if (valEl) valEl.textContent = Math.round(v * 100) + '%';
      // Cascade words
      cascadedSet = cascadeFromSliders();
      renderPreview();
      // Incremental updates
      updateDropdownSelections();
      updateCoherenceBanner();
      updateRadar();
    });
  }

  // Radar inline
  const radarDiv = document.createElement('div');
  radarDiv.className = 'radar-inline';
  radarDiv.id = 'radar-container';
  radarDiv.innerHTML = renderRadar(voice, lens);
  slidersDiv.appendChild(radarDiv);

  // Voice decomposition (shows Brand Voice breakdown when on non-identity lens)
  const decompContainer = document.createElement('div');
  decompContainer.id = 'voice-decomp-container';
  decompContainer.innerHTML = renderVoiceDecomp();
  slidersDiv.appendChild(decompContainer);

  el.appendChild(slidersDiv);

  // ── Word Selections ──
  const groups: Record<string, Axis[]> = {};
  for (const axis of AXES) (groups[axis.group] ??= []).push(axis);

  for (const [groupName, axes] of Object.entries(groups)) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'control-group';
    groupDiv.innerHTML = `<div class="control-group-title">${groupName}</div>`;

    for (const axis of axes) {
      const as = axisState[axis.id];
      const isCasc = cascadedSet.has(axis.id);
      const row = document.createElement('div');
      row.className = 'axis-row';

      const header = document.createElement('div');
      header.className = 'axis-header';
      header.innerHTML = `
        <span class="axis-label">${axis.label}</span>
        ${isCasc ? '<span class="cascade-flash visible">MATCHED</span>' : ''}
        <button class="lock-btn ${as.locked ? 'locked' : ''}" title="${as.locked ? 'Unlock' : 'Lock'}">
          ${as.locked ? '\uD83D\uDD12' : '\uD83D\uDD13'}
        </button>
      `;
      header.querySelector('.lock-btn')!.addEventListener('click', () => {
        as.locked = !as.locked;
        if (!as.locked) { cascadedSet = cascadeFromSliders(); }
        renderControls(); renderPreview();
        clearCascadeHighlights();
      });

      const wrap = document.createElement('div');
      wrap.className = `axis-select-wrap ${as.locked ? 'locked' : ''} ${isCasc ? 'cascaded' : ''}`;
      wrap.id = `wrap-${axis.id}`;

      const select = document.createElement('select');
      select.id = `sel-${axis.id}`;
      for (let i = 0; i < axis.options.length; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = axis.options[i].label;
        if (i === as.selected) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        as.selected = parseInt(select.value, 10);
        as.locked = true;
        cascadedSet = cascadeFromSliders();
        renderControls(); renderPreview();
        clearCascadeHighlights();
      });
      wrap.appendChild(select);

      // Sem dots
      const sem = axis.options[as.selected].sem;
      const dots = document.createElement('div');
      dots.className = 'sem-dots';
      for (let d = 0; d < 6; d++) {
        const dotEl = document.createElement('div');
        dotEl.className = 'sem-dot';
        dotEl.style.background = VOICE_DIM_COLORS[d];
        dotEl.style.opacity = String(Math.max(sem[d] * 0.9, 0.05));
        dots.appendChild(dotEl);
      }
      wrap.appendChild(dots);
      row.appendChild(header);
      row.appendChild(wrap);
      groupDiv.appendChild(row);
    }
    el.appendChild(groupDiv);
  }

  // Reset
  const btn = document.createElement('button');
  btn.className = 'btn-reset';
  btn.textContent = 'Reset All';
  btn.addEventListener('click', () => { initState(); cascadedSet.clear(); renderControls(); renderPreview(); });
  el.appendChild(btn);
}

// ── Lens Switching ──

function switchLens(newLensId: string) {
  currentLensId = newLensId;
  const newLens = getCurrentLens();
  // Reverse-map current targetVoice into new lens space
  lensSliderValues = reverseMap(newLens, targetVoice);
  // Full rebuild
  renderControls();
  // No need to re-cascade — targetVoice hasn't changed
}

// ── Incremental updates (called during slider drag for performance) ──

function updateDropdownSelections() {
  for (const axis of AXES) {
    const sel = document.getElementById(`sel-${axis.id}`) as HTMLSelectElement | null;
    if (sel && sel.value !== String(axisState[axis.id].selected)) {
      sel.value = String(axisState[axis.id].selected);
      const wrap = document.getElementById(`wrap-${axis.id}`);
      if (wrap) { wrap.classList.add('cascaded'); setTimeout(() => wrap.classList.remove('cascaded'), 600); }
    }
  }
}

function updateCoherenceBanner() {
  const voice = computeActualVoice();
  const coherence = computeCoherence();
  const pct = Math.round(coherence * 100);
  const color = pct >= 70 ? '#22c55e' : pct >= 50 ? '#eab308' : '#ef4444';
  const desc = pct >= 70 ? 'Strong coherence' : pct >= 50 ? 'Moderate \u2014 some tension' : 'Semantic tension';
  const banner = document.querySelector('.coherence-banner');
  if (banner) {
    banner.querySelector('.coherence-bar-fill')?.setAttribute('style', `width:${pct}%;background:${color}`);
    const valEl = banner.querySelector('.coherence-value');
    if (valEl) { (valEl as HTMLElement).style.color = color; valEl.textContent = pct + '%'; }
    const descEl = banner.querySelector('.coherence-desc');
    if (descEl) descEl.textContent = desc;
    const voiceEl = banner.querySelector('.voice-label');
    if (voiceEl) voiceEl.textContent = 'Voice: ' + dominantDims(voice);
  }
}

function updateRadar() {
  const container = document.getElementById('radar-container');
  if (container) container.innerHTML = renderRadar(computeActualVoice(), getCurrentLens());
  // Also update voice decomposition
  const decompContainer = document.getElementById('voice-decomp-container');
  if (decompContainer) decompContainer.innerHTML = renderVoiceDecomp();
}

function clearCascadeHighlights() {
  setTimeout(() => {
    cascadedSet.clear();
    document.querySelectorAll('.cascade-flash').forEach(b => b.classList.remove('visible'));
    document.querySelectorAll('.axis-select-wrap.cascaded').forEach(w => w.classList.remove('cascaded'));
  }, 1000);
}

// ─── Preview Rendering ────────────────────────────────────────────────────────

function t(text: string, cls: string): string {
  return `<span class="term ${cls}">${text}</span>`;
}

function renderPreview() {
  const el = document.getElementById('preview')!;
  const step1 = val('step1'), step2 = val('step2'), step3 = val('step3');
  const platform = val('platform'), fulfillment = val('fulfillment');
  const device = val('device'), cartridge = val('cartridge');
  const user = val('user'), output = val('output'), creatorAction = val('creatorAction');
  const domain = val('domain'), positioning = val('positioning');
  const intent = val('intent'), subscription = val('subscription');
  const oLc = valLower('output'), oLcP = oLc + 's';
  const uLc = valLower('user'), uLcP = uLc + 's';
  const s3lc = valLower('step3');
  const devRole = s3lc === 'play' ? 'Player' : s3lc === 'stream' ? 'Streamer' : s3lc === 'execute' ? 'Executor' : s3lc === 'dose' ? 'Doser' : 'Device';
  const s2gerund = valLower('step2') === 'stream' ? 'streaming' : valLower('step2') === 'compile' ? 'compilation' : valLower('step2') === 'activate' ? 'activation' : 'transmission';
  const s3gerund = s3lc === 'stream' ? 'streaming' : s3lc === 'play' ? 'playback' : s3lc === 'execute' ? 'execution' : 'delivery';

  el.innerHTML = `
    <div class="preview-section">
      <h2>Brand Tagline</h2>
      <div class="hero-brand"><strong>Lx.health</strong></div>
      <div class="hero-tagline">${t(positioning, 't-position')} ${t(domain, 't-domain')}</div>
      <div class="hero-sub">Biological ${oLc} ${s3gerund} through intelligent ${s2gerund}</div>
    </div>

    <div class="preview-section">
      <h2>The 3-Step Flow</h2>
      <div class="flow-steps">
        <div class="flow-step">
          <div class="flow-verb">${t(step1, 't-verb')}</div>
          <div class="flow-product">${t(platform, 't-product')}</div>
          <div class="flow-desc">Input your target impact. Our AI generates your personalized ${t(oLc, 't-output')} or matches you with ${t(user, 't-user')} ${t(oLcP, 't-output')}.</div>
        </div>
        <div class="flow-arrow">\u2192</div>
        <div class="flow-step">
          <div class="flow-verb">${t(step2, 't-verb')}</div>
          <div class="flow-product">${t(fulfillment, 't-product')}</div>
          <div class="flow-desc">Instant API transmission to ${t(fulfillment, 't-product')}. Automated fulfillment compiling your custom ${t(oLc, 't-output')} into a ${t(cartridge, 't-cartridge')}.</div>
        </div>
        <div class="flow-arrow">\u2192</div>
        <div class="flow-step">
          <div class="flow-verb">${t(step3, 't-verb')}</div>
          <div class="flow-product">${t(device, 't-product')}</div>
          <div class="flow-desc">Precision adaptive delivery. One-touch dosing via the ${t(device, 't-product')}, closing the loop between biometrics and biological outcome.</div>
        </div>
      </div>
    </div>

    <div class="preview-section">
      <h2>The Lx Ecosystem</h2>
      <div class="product-card">
        <div class="product-name">${t(platform, 't-product')}</div>
        <div class="product-subtitle">Agent & Marketplace</div>
        <div class="product-desc">A platform where users ${t(valLower('step1'), 't-verb')} precision ${t(oLcP, 't-output')} by syncing biometrics with our AI. Includes a marketplace for ${t(uLcP, 't-user')} to ${t(valLower('creatorAction'), 't-action')} high-rated ${t(oLcP, 't-output')}, driving user adoption with near-zero CAC.</div>
      </div>
      <div class="product-card">
        <div class="product-name">${t(device, 't-product')}</div>
        <div class="product-subtitle">The ${t(output, 't-output')} ${t(devRole, 't-verb')}</div>
        <div class="product-desc">A pocket-sized agent-driven device. It ${s3lc}s adaptive supplement ${t(oLcP, 't-output')} via a ${t(cartridge, 't-cartridge')} with robotic precision.</div>
      </div>
      <div class="product-card">
        <div class="product-name">${t(fulfillment, 't-product')}</div>
        <div class="product-subtitle">Decentralized Factory</div>
        <div class="product-desc">A fractal fulfillment network. Each ${t(cartridge, 't-cartridge')} is assembled on-demand using the same robotic module as the ${t(device, 't-product')}.</div>
      </div>
    </div>

    <div class="preview-section">
      <h2>Sample Copy (One-Pager)</h2>
      <div class="copy-block">
        <div class="copy-label">Executive Summary</div>
        LX.Health is ${t(positioning, 't-position')} the bio-data era. We provide a real-time, closed-loop system that allows users to ${t(valLower('step2'), 't-verb')} intelligent supplement ${t(oLcP, 't-output')} directly into their daily routine. By integrating agentic ${t(oLc, 't-output')} ${valLower('step1')} with a decentralized robotic fulfillment network and agent-executing hardware, we are establishing the global ${t(positioning.replace('The ','').replace(' for',''), 't-position')} for measurable ${t(domain.toLowerCase(), 't-domain')}.
      </div>
      <div class="copy-block">
        <div class="copy-label">The Opportunity</div>
        The wearable market is saturated with data but lacks the "Action Layer." LX.Health bridges the gap between Bio-Data and Bio-Intake. Your biological '${t(intent.split(' \u2192 ')[0], 't-intent')}' is instantly translated into physical '${t(intent.split(' \u2192 ')[1], 't-intent')}'.
      </div>
      <div class="copy-block">
        <div class="copy-label">Business Model</div>
        <strong>${t(subscription, 't-sub')}:</strong> $29/month membership for ${t(platform, 't-product')} access, Agent-driven optimizations, and ${t(uLc, 't-user')}-led adaptive ${t(oLcP, 't-output')}.<br><br>
        <strong>Hardware Entry:</strong> $99 via the ${t(device, 't-product')}.<br><br>
        <strong>Growth Engine:</strong> ${t(uLcP, 't-user')} ${t(valLower('creatorAction'), 't-action')} their ${t(oLcP, 't-output')} to bypass traditional ad-spend while generating a proprietary "Outcome Map."
      </div>
      <div class="copy-block">
        <div class="copy-label">Investment Moat</div>
        As more ${t(uLcP, 't-user')} ${t(valLower('creatorAction'), 't-action')} ${t(oLcP, 't-output')} and more ${t(fulfillment, 't-product')} nodes deploy, the platform becomes the standard ${t(positioning.replace('The ','').replace(' for',''), 't-position')} for ${t(domain.toLowerCase(), 't-domain')} management.
      </div>
    </div>

    <div class="preview-section">
      <h2>Current Terminology Map</h2>
      <div class="term-map">
        ${AXES.map(a => {
          const o = a.options[axisState[a.id].selected];
          return `<div class="term-map-item">
            <span class="term-map-label">${a.label} ${axisState[a.id].locked ? '\uD83D\uDD12' : ''}</span>
            <span class="term-map-value term ${a.termClass}">${o.label}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

initState();
renderControls();
renderPreview();
