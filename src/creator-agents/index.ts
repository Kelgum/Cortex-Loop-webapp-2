// ============================================
// Agent Marketplace Database — Cortex Loop
// KOL-authored protocol agents
// ============================================

import type { AgentConfig } from '../creator-agent-types';

import { hubermanAgent } from './huberman';
import { attiaAgent } from './attia';
import { johnsonAgent } from './johnson';
import { patrickAgent } from './patrick';
import { sinclairAgent } from './sinclair';
import { greenfieldAgent } from './greenfield';
import { dagostinoAgent } from './dagostino';
import { saladinoAgent } from './saladino';
import { hymanAgent } from './hyman';
import { ferrissAgent } from './ferriss';
import { aspreyAgent } from './asprey';
import { whittenAgent } from './whitten';
import { nortonAgent } from './norton';
import { woodAgent } from './wood';
import { simsAgent } from './sims';
import { galpinAgent } from './galpin';
import { lyonAgent } from './lyon';
import { gottfriedAgent } from './gottfried';
import { palmerAgent } from './palmer';
import { breckaAgent } from './brecka';

/** All KOL protocol agents */
export const AGENT_DATABASE: AgentConfig[] = [
    hubermanAgent,
    attiaAgent,
    johnsonAgent,
    patrickAgent,
    sinclairAgent,
    greenfieldAgent,
    dagostinoAgent,
    saladinoAgent,
    hymanAgent,
    ferrissAgent,
    aspreyAgent,
    whittenAgent,
    nortonAgent,
    woodAgent,
    simsAgent,
    galpinAgent,
    lyonAgent,
    gottfriedAgent,
    palmerAgent,
    breckaAgent,
] as AgentConfig[];

/** @deprecated Use AGENT_DATABASE instead */
export const BUNDLED_AGENTS = AGENT_DATABASE;

/** Lookup agent by ID */
export function getAgentById(id: string): AgentConfig | undefined {
    return AGENT_DATABASE.find(a => a.id === id);
}

/** Lookup agent by creator handle (e.g. '@hubermanlab') */
export function getAgentByHandle(handle: string): AgentConfig | undefined {
    return AGENT_DATABASE.find(a => a.meta.creatorHandle === handle);
}

/** Filter agents by domain tag */
export function getAgentsByDomain(tag: string): AgentConfig[] {
    return AGENT_DATABASE.filter(a => a.meta.domainTags.includes(tag));
}

/** Search agents by keyword match against domainMatchKeywords */
export function searchAgents(query: string): AgentConfig[] {
    const q = query.toLowerCase().trim();
    return AGENT_DATABASE.filter(a => a.domainMatchKeywords?.some((kw: string) => kw.toLowerCase().includes(q))).sort(
        (a, b) => (b.efficacyScore ?? 0) - (a.efficacyScore ?? 0),
    );
}
