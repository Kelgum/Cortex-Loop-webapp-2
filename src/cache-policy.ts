import { LLMCache } from './llm-cache';

export const CACHE_STAGE_LABELS: Record<string, string> = {
    'fast-model': 'Scout',
    'main-model': 'Strategist',
    'intervention-model': 'Chess Player',
    'sherlock-model': 'Sherlock',
    'biometric-rec-model': 'Spotter (Device)',
    'biometric-profile-model': 'Spotter (Profile)',
    'biometric-channel-model': 'Spotter (Channel)',
    'biometric-model': 'Spotter (Sim)',
    'strategist-bio-model': 'Strategist Bio',
    'revision-model': 'Grandmaster',
    'sherlock-revision-model': 'Sherlock (Rev)',
    'knight-model': 'Knight',
    'spotter-daily-model': 'Spotter (7d)',
    'strategist-bio-daily-model': 'Strategist Bio (7d)',
    'grandmaster-daily-model': 'Grandmaster (7d)',
};

export const CACHE_STAGE_UPSTREAM_DEPS: Record<string, string[]> = {
    'intervention-model': ['fast-model', 'main-model'],
    'sherlock-model': ['intervention-model'],
    'biometric-rec-model': ['main-model', 'intervention-model'],
    'biometric-profile-model': ['biometric-rec-model'],
    'biometric-channel-model': ['biometric-profile-model'],
    'biometric-model': ['biometric-channel-model', 'intervention-model'],
    'strategist-bio-model': ['biometric-model', 'main-model'],
    'revision-model': ['strategist-bio-model', 'biometric-model', 'intervention-model'],
    'sherlock-revision-model': ['revision-model'],
    'knight-model': ['main-model'],
    'spotter-daily-model': ['biometric-model', 'knight-model'],
    'strategist-bio-daily-model': ['spotter-daily-model', 'main-model'],
    'grandmaster-daily-model': ['strategist-bio-daily-model', 'knight-model', 'intervention-model'],
};

function reverseDependencyMap(): Record<string, string[]> {
    const reverse: Record<string, string[]> = {};
    for (const [stageClass, upstream] of Object.entries(CACHE_STAGE_UPSTREAM_DEPS)) {
        for (const upstreamStageClass of upstream) {
            if (!reverse[upstreamStageClass]) reverse[upstreamStageClass] = [];
            reverse[upstreamStageClass].push(stageClass);
        }
    }
    return reverse;
}

const CACHE_STAGE_DOWNSTREAM_DEPS = reverseDependencyMap();

export function normalizeCacheStageClass(stageClass: string): string {
    const normalized = String(stageClass || '').trim();
    return normalized;
}

export function getStageCacheLabel(stageClass: string): string {
    const normalized = normalizeCacheStageClass(stageClass);
    return CACHE_STAGE_LABELS[normalized] || normalized || 'Agent';
}

export function describeStageClasses(stageClasses: string[]): string {
    const unique = Array.from(
        new Set((stageClasses || []).map(stageClass => normalizeCacheStageClass(stageClass)).filter(Boolean)),
    );
    return unique.map(stageClass => getStageCacheLabel(stageClass)).join(', ');
}

export function getDependencyUpstreamStageClasses(stageClass: string): string[] {
    const normalized = normalizeCacheStageClass(stageClass);
    const ordered: string[] = [];
    const visited = new Set<string>();

    const visit = (current: string) => {
        const upstream = CACHE_STAGE_UPSTREAM_DEPS[current] || [];
        for (const upstreamStageClass of upstream) {
            const normalizedUpstream = normalizeCacheStageClass(upstreamStageClass);
            if (!normalizedUpstream || visited.has(normalizedUpstream)) continue;
            visited.add(normalizedUpstream);
            visit(normalizedUpstream);
            ordered.push(normalizedUpstream);
        }
    };

    visit(normalized);
    return ordered;
}

export function getDependencyDownstreamStageClasses(stageClass: string): string[] {
    const normalized = normalizeCacheStageClass(stageClass);
    const ordered: string[] = [];
    const visited = new Set<string>();

    const visit = (current: string) => {
        const downstream = CACHE_STAGE_DOWNSTREAM_DEPS[current] || [];
        for (const downstreamStageClass of downstream) {
            const normalizedDownstream = normalizeCacheStageClass(downstreamStageClass);
            if (!normalizedDownstream || visited.has(normalizedDownstream)) continue;
            visited.add(normalizedDownstream);
            ordered.push(normalizedDownstream);
            visit(normalizedDownstream);
        }
    };

    visit(normalized);
    return ordered;
}

export function getDisabledUpstreamCacheStages(stageClass: string): string[] {
    return getDependencyUpstreamStageClasses(stageClass).filter(
        upstreamStageClass => !LLMCache.isEnabled(upstreamStageClass),
    );
}

export function enableStageCacheChain(stageClass: string, ensureData?: (stageClass: string) => void): string[] {
    const normalized = normalizeCacheStageClass(stageClass);
    const chain = [...getDependencyUpstreamStageClasses(normalized), normalized];
    const enabled: string[] = [];

    for (const targetStageClass of chain) {
        ensureData?.(targetStageClass);
        if (!LLMCache.isEnabled(targetStageClass)) {
            LLMCache.enable(targetStageClass);
            enabled.push(targetStageClass);
        }
    }

    return enabled;
}

export function disableStageCacheChain(
    stageClass: string,
    options: { includeSelf?: boolean; clearData?: boolean } = {},
): string[] {
    const normalized = normalizeCacheStageClass(stageClass);
    const affected = options.includeSelf
        ? [normalized, ...getDependencyDownstreamStageClasses(normalized)]
        : getDependencyDownstreamStageClasses(normalized);
    const changed: string[] = [];
    const seen = new Set<string>();

    for (const targetStageClass of affected) {
        const normalizedTarget = normalizeCacheStageClass(targetStageClass);
        if (!normalizedTarget || seen.has(normalizedTarget)) continue;
        seen.add(normalizedTarget);

        let touched = false;
        if (LLMCache.isEnabled(normalizedTarget)) {
            LLMCache.disable(normalizedTarget);
            touched = true;
        }
        if (options.clearData && LLMCache.hasData(normalizedTarget)) {
            LLMCache.clear(normalizedTarget);
            touched = true;
        }
        if (touched) changed.push(normalizedTarget);
    }

    return changed;
}

/**
 * Returns the stage classes that have been fully consumed/rendered
 * by the time a given phase completes. Used by break-from-cache
 * to know which stages to preserve in the new live draft.
 */
export function getCompletedStageClassesForPhase(phase: number): string[] {
    const map: Record<number, string[]> = {
        0: ['fast-model', 'main-model'],
        1: ['fast-model', 'main-model'],
        2: ['fast-model', 'main-model', 'intervention-model', 'sherlock-model'],
        3: [
            'fast-model',
            'main-model',
            'intervention-model',
            'sherlock-model',
            'biometric-rec-model',
            'biometric-profile-model',
            'biometric-channel-model',
            'biometric-model',
            'strategist-bio-model',
        ],
        4: [
            'fast-model',
            'main-model',
            'intervention-model',
            'sherlock-model',
            'biometric-rec-model',
            'biometric-profile-model',
            'biometric-channel-model',
            'biometric-model',
            'strategist-bio-model',
            'revision-model',
            'sherlock-revision-model',
        ],
    };
    return map[phase] || [];
}

export function reconcileEnabledCacheDependencies(options: { clearData?: boolean } = {}): string[] {
    const changed = new Set<string>();
    let repaired = true;

    while (repaired) {
        repaired = false;
        for (const stageClass of Object.keys(CACHE_STAGE_LABELS)) {
            if (!LLMCache.isEnabled(stageClass)) continue;
            const missingUpstream = getDisabledUpstreamCacheStages(stageClass);
            if (missingUpstream.length === 0) continue;
            const disabled = disableStageCacheChain(stageClass, {
                includeSelf: true,
                clearData: !!options.clearData,
            });
            if (disabled.length > 0) {
                repaired = true;
                disabled.forEach(disabledStageClass => changed.add(disabledStageClass));
            }
        }
    }

    return Array.from(changed);
}
