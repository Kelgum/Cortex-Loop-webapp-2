# Agent Marketplace Database

KOL-authored protocol agents for the Cortex Loop Agentic Protocol Marketplace. Each agent encodes the supplement philosophy, optimization weights, guardrails, and signature interventions of a real figure in the biohacking/longevity/performance space.

## Schema

Each agent is an `AgentConfig` object (defined in `src/creator-agent-types.ts`):

```typescript
{
  id: string;                    // "{handle}-agent-v1"
  meta: {
    name: string;                // Signature protocol name
    creatorHandle: string;       // "@handle"
    creatorName: string;         // Full name
    avatarUrl: string;           // Official avatar URL
    tagline: string;             // 80 chars max, their focus in their voice
    domainTags: string[];        // From: Focus|Sleep|Recovery|Longevity|Stress|Performance|Mood|Metabolic|Pain|Neuroplasticity
    targetPopulation: string;    // Who they address
    followerProxy: string;       // Audience size
    credentials: string;         // Professional credentials
    createdAt: string;           // ISO date
  };
  mandate: string;               // 150-300 words, in their voice
  substancePalette: {
    categories: string[];        // Substance categories they recommend
    gated: {
      rx: boolean;               // Discusses Rx drugs publicly?
      controlled: boolean;       // Discusses psychedelics/controlled substances?
    };
    dosingPhilosophy: number;    // 0.0 (microdose-first) to 1.0 (clinical-range)
  };
  optimizationWeights: {         // Each 0-100
    acutePerformance: number;
    recoverySleep: number;
    longTermNeuroplasticity: number;
    minimalSideEffects: number;
    costEfficiency: number;
  };
  guardrails: string[];          // 3-5 hard rules in their voice
  signatureInterventions: [{
    substance: string;           // Substance name (human-readable)
    timing: string;              // Their specific recommendation
    rationale: string;           // Their stated reason (max 100 chars)
  }];
  efficacyScore: number;         // 3.5-4.9, scientific rigor rating
  domainMatchKeywords: string[]; // 5-10 search keywords
}
```

## Current Agents (20)

| #   | Handle            | Name            | Protocol                               | Domains                       | Efficacy |
| --- | ----------------- | --------------- | -------------------------------------- | ----------------------------- | -------- |
| 1   | @hubermanlab      | Andrew Huberman | Neural Optimization Stack              | Focus, Sleep, Neuroplasticity | 4.5      |
| 2   | @PeterAttiaMD     | Peter Attia     | Medicine 3.0 Longevity Protocol        | Longevity, Metabolic          | 4.8      |
| 3   | @bryanjohnson\_   | Bryan Johnson   | Blueprint Longevity Stack              | Longevity, Sleep              | 4.2      |
| 4   | @foundmyfitness   | Rhonda Patrick  | Micronutrient Optimization Engine      | Longevity, Neuroplasticity    | 4.6      |
| 5   | @davidasinclair   | David Sinclair  | Epigenetic Reprogramming Protocol      | Longevity, Metabolic          | 3.9      |
| 6   | @bengreenfield    | Ben Greenfield  | Boundless Biohacker Stack              | Performance, Recovery         | 3.7      |
| 7   | @dominicdagostino | Dom D'Agostino  | Metabolic Flexibility Protocol         | Metabolic, Focus              | 4.4      |
| 8   | @carnivoremd      | Paul Saladino   | Animal-Based Vitality Protocol         | Metabolic, Performance        | 3.5      |
| 9   | @drmarkhyman      | Mark Hyman      | Functional Medicine Reset              | Metabolic, Mood               | 4.0      |
| 10  | @tferriss         | Tim Ferriss     | Minimum Effective Dose Engine          | Focus, Performance            | 4.1      |
| 11  | @bulletproofexec  | Dave Asprey     | Bulletproof Mitochondrial Stack        | Focus, Performance            | 3.6      |
| 12  | @ariwhitten       | Ari Whitten     | Energy Blueprint Protocol              | Recovery, Metabolic           | 3.8      |
| 13  | @biolayne         | Layne Norton    | Evidence-Based Performance Stack       | Performance, Recovery         | 4.7      |
| 14  | @drtommywood      | Tommy Wood      | Brain-Body Metabolic Protocol          | Neuroplasticity, Metabolic    | 4.5      |
| 15  | @drstacysims      | Stacy Sims      | Female Physiology Performance Protocol | Performance, Recovery         | 4.4      |
| 16  | @drandygalpin     | Andy Galpin     | Adaptation-Specific Training Fuel      | Performance, Recovery         | 4.5      |
| 17  | @drgabriellelyon  | Gabrielle Lyon  | Muscle-Centric Medicine Protocol       | Longevity, Performance        | 4.3      |
| 18  | @saragottfriedmd  | Sara Gottfried  | Hormone Intelligence Protocol          | Stress, Sleep, Mood           | 4.0      |
| 19  | @chrispalmermd    | Chris Palmer    | Metabolic Psychiatry Protocol          | Mood, Neuroplasticity         | 4.3      |
| 20  | @garybrecka       | Gary Brecka     | 10X Genetic Optimization Stack         | Performance, Focus            | 3.5      |

## Adding a New Agent

1. Create `src/agents/{handle}.ts` exporting a const matching the schema above
2. Import and add to the `AGENT_DATABASE` array in `src/agents/index.ts`
3. Run `npm run typecheck` to verify the agent conforms to `AgentConfig`

## API

```typescript
import { AGENT_DATABASE, getAgentById, getAgentByHandle, getAgentsByDomain, searchAgents } from './agents';

// Get all agents
AGENT_DATABASE; // AgentConfig[]

// Lookup by ID
getAgentById('hubermanlab-agent-v1');

// Lookup by handle
getAgentByHandle('@hubermanlab');

// Filter by domain
getAgentsByDomain('Focus'); // All focus-tagged agents

// Keyword search (sorted by efficacy)
searchAgents('keto'); // D'Agostino, Palmer, etc.
```

## Design Principles

- **Authenticity**: Each mandate is written in the KOL's actual voice and vocabulary
- **Differentiation**: No two mandates should be interchangeable
- **Specificity**: Guardrails and interventions reflect real public positions
- **Honesty**: efficacyScore reflects perceived scientific rigor, not popularity
