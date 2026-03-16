// ── Agent Designer & Protocol Browser types ──────────────────────────

export interface AgentMeta {
    name: string;
    creatorHandle: string;
    avatarUrl: string;
    tagline: string;
    domainTags: string[];
    targetPopulation: string;
    createdAt: string;
    // Optional fields present in some agent files
    creatorName?: string;
    followerProxy?: string;
    credentials?: string;
}

export interface AgentSubstancePalette {
    categories: string[];
    gated: { rx: boolean; controlled: boolean };
    dosingPhilosophy: number; // 0–1 continuous (0 = microdose-first, 1 = clinical-range)
}

export interface AgentOptimizationWeights {
    acutePerformance: number;
    recoverySleep: number;
    longTermNeuroplasticity: number;
    minimalSideEffects: number;
    costEfficiency: number;
}

export interface AgentSignatureIntervention {
    substanceKey?: string;
    substance?: string; // alias used by some agent files
    timing: string;
    rationale: string;
}

export interface AgentConfig {
    id: string;
    meta: AgentMeta;
    mandate: string;
    substancePalette: AgentSubstancePalette;
    optimizationWeights: AgentOptimizationWeights;
    guardrails: string[];
    signatureInterventions: AgentSignatureIntervention[];
    // Optional fields present in some agent files
    efficacyScore?: number;
    domainMatchKeywords?: string[];
}

// ── Domain constants ─────────────────────────────────────────────────

export const DOMAIN_TAGS = [
    'Focus',
    'Sleep',
    'Recovery',
    'Longevity',
    'Stress',
    'Performance',
    'Mood',
    'Metabolic',
    'Pain',
    'Neuroplasticity',
] as const;

export const SUBSTANCE_CATEGORIES = [
    'Stimulants',
    'Adaptogens',
    'Nootropics',
    'Minerals',
    'Vitamins',
    'Sleep',
] as const;

export const GATED_CATEGORIES = ['Rx Pharmaceuticals', 'Controlled Substances'] as const;

export const DOSING_LABELS = [
    'Microdose-First',
    'Conservative',
    'Evidence-Based Standard',
    'Performance-Optimized',
    'Clinical-Range',
] as const;

export const DOSING_DESCRIPTIONS = [
    'Agent will prefer sub-therapeutic doses, prioritizing tolerability',
    'Agent will start low, titrating up only with evidence of tolerance',
    'Agent will use evidence-based standard doses',
    'Agent will optimize for peak effect within safety margins',
    'Agent will prescribe at clinical ceiling doses where evidence supports',
] as const;

export const MANDATE_PRESETS: { label: string; text: string }[] = [
    {
        label: 'Conservative Adaptogen-First',
        text: 'This agent prioritizes adaptogenic and nutritional interventions before considering synthetic compounds. It optimizes for long-term resilience over acute performance spikes, avoids polypharmacy, and always includes cycling protocols. Hard limit: never more than 3 active substances in any 24h window. Designed for health-conscious professionals who want sustainable cognitive support without dependency risk.',
    },
    {
        label: 'Performance Maximalist',
        text: 'This agent is designed for high-performers who accept calculated trade-offs for peak output. It will stack compounds aggressively when pharmacodynamic curves align, leverage synergistic combinations, and push dosing toward the upper evidence-based range. It respects contraindications but does not shy away from complexity. Designed for athletes, founders, and operators who need maximum throughput.',
    },
    {
        label: 'Clinical Precision',
        text: 'This agent operates like a clinical pharmacologist. Every intervention must have peer-reviewed evidence with defined effect sizes. It models drug-drug interactions explicitly, accounts for individual variance via biometric feedback, and documents rationale for every decision. Conservative by default but will escalate when data supports it. Designed for physicians and researchers who demand rigor.',
    },
];

export const DEFAULT_GUARDRAILS = [
    'Never co-prescribe MAOIs with serotonergic substances',
    'Never exceed 400mg total caffeine in any 24h window',
    'Always include a sleep-support substance if stimulants are prescribed post-14:00',
];
