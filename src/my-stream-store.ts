/**
 * my-stream-store — localStorage persistence for the My Stream element.
 * Tracks which protocols have been added to the user's 28-day stream
 * and manages per-day spoke slot allocations with capsule/tablet distinction.
 *
 * Exports: addToStream, removeFromStream, getStreamProtocols, getDaySlots,
 *          isInStream, clearStream, getStreamSummary, parseDoseMg
 * Depends on: settings-store, constants
 */

import { settingsStore } from './settings-store';
import { MY_STREAM } from './constants';

// ── Types ──────────────────────────────────────────────────────────

export interface SlotFill {
    spokeIndex: number; // 1-25 (0 is mechanical empty)
    slotPosition: number; // 0 for capsules; 0-4 for tablets within a spoke
    isCapsule: boolean;
    substanceName: string;
    substanceColor: string;
    dose: string;
    sourceProtocol: string; // cycleId
}

export interface DaySlotAllocation {
    day: number;
    slots: SlotFill[];
}

export interface StreamProtocol {
    cycleId: string;
    filename: string;
    addedAt: string;
    days: DaySlotAllocation[];
}

/** Minimal substance info needed for slot allocation. */
export interface SubstanceInput {
    name: string;
    color: string;
    dose: string;
    timeMinutes: number;
}

// ── Storage key ────────────────────────────────────────────────────

const STREAM_KEY = 'cortex_my_stream_protocols';
const COLLAPSE_KEY = 'cortex_my_stream_collapsed';

// ── In-memory cache ────────────────────────────────────────────────

let _protocols: StreamProtocol[] = [];

function load(): StreamProtocol[] {
    if (_protocols.length > 0) return _protocols;
    _protocols = settingsStore.getJson<StreamProtocol[]>(STREAM_KEY, []);
    return _protocols;
}

function persist(): void {
    settingsStore.setJson(STREAM_KEY, _protocols);
}

// ── Dose parsing ───────────────────────────────────────────────────

/** Parse a dose string ("100mg", "5g", "500mcg") into milligrams. Returns 0 on failure. */
export function parseDoseMg(dose: string): number {
    if (!dose) return 0;
    const match = dose.match(/([\d.]+)\s*(mg|g|mcg|ug|µg)/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 'g') return value * 1000;
    if (unit === 'mcg' || unit === 'ug' || unit === 'µg') return value / 1000;
    return value; // mg
}

/** Check if a dose qualifies as a capsule (> threshold). */
function isCapsuleDose(dose: string): boolean {
    return parseDoseMg(dose) > MY_STREAM.capsuleThresholdMg;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Add a protocol to the stream. `daySubstances` is an array of arrays,
 * each containing that day's substances sorted by timeMinutes.
 * If shorter than 28 days, tiles to fill 28.
 */
export function addToStream(cycleId: string, filename: string, daySubstances: SubstanceInput[][]): void {
    load();

    // Remove existing entry for this cycle (re-add = refresh)
    _protocols = _protocols.filter(p => p.cycleId !== cycleId);

    // Tile to 28 days if shorter
    const tiled: SubstanceInput[][] = [];
    for (let d = 0; d < MY_STREAM.days; d++) {
        tiled.push(daySubstances[d % daySubstances.length] || []);
    }

    // Allocate slots for each day
    const days: DaySlotAllocation[] = tiled.map((substances, day) => {
        // Collect already-occupied spokes + tablet positions for this day
        const spokeOccupied = new Map<number, Set<number>>(); // spokeIndex → set of slotPositions
        for (const p of _protocols) {
            const dayAlloc = p.days.find(da => da.day === day);
            if (dayAlloc) {
                for (const s of dayAlloc.slots) {
                    if (!spokeOccupied.has(s.spokeIndex)) spokeOccupied.set(s.spokeIndex, new Set());
                    spokeOccupied.get(s.spokeIndex)!.add(s.slotPosition);
                    // If a capsule occupies this spoke, mark all 5 positions
                    if (s.isCapsule) {
                        for (let p = 0; p < MY_STREAM.tabletsPerSpoke; p++) {
                            spokeOccupied.get(s.spokeIndex)!.add(p);
                        }
                    }
                }
            }
        }

        const sorted = [...substances].sort((a, b) => a.timeMinutes - b.timeMinutes);

        // Separate into capsules and tablets
        const capsules = sorted.filter(s => isCapsuleDose(s.dose));
        const tablets = sorted.filter(s => !isCapsuleDose(s.dose));

        const slots: SlotFill[] = [];
        let nextSpoke = 1; // start at 1 (0 is mechanical empty)

        // Helper: find next spoke that's completely free
        function nextFreeSpoke(): number {
            while (nextSpoke <= MY_STREAM.substanceSlots) {
                const positions = spokeOccupied.get(nextSpoke);
                if (!positions || positions.size === 0) return nextSpoke;
                nextSpoke++;
            }
            return -1; // overflow
        }

        // Assign capsules first — each takes a full spoke
        for (const cap of capsules) {
            const spoke = nextFreeSpoke();
            if (spoke < 0) break;

            slots.push({
                spokeIndex: spoke,
                slotPosition: 0,
                isCapsule: true,
                substanceName: cap.name,
                substanceColor: cap.color,
                dose: cap.dose,
                sourceProtocol: cycleId,
            });

            // Mark all positions occupied
            if (!spokeOccupied.has(spoke)) spokeOccupied.set(spoke, new Set());
            for (let p = 0; p < MY_STREAM.tabletsPerSpoke; p++) {
                spokeOccupied.get(spoke)!.add(p);
            }
            nextSpoke = spoke + 1;
        }

        // Assign tablets — up to 5 per spoke
        let tabletSpoke = nextSpoke;
        let tabletPos = 0;

        // Find a spoke with room for another tablet
        function nextTabletSlot(): { spoke: number; pos: number } | null {
            while (tabletSpoke <= MY_STREAM.substanceSlots) {
                const positions = spokeOccupied.get(tabletSpoke);
                if (!positions) return { spoke: tabletSpoke, pos: 0 };
                // Find first free position in this spoke
                for (let p = 0; p < MY_STREAM.tabletsPerSpoke; p++) {
                    if (!positions.has(p)) return { spoke: tabletSpoke, pos: p };
                }
                tabletSpoke++;
                tabletPos = 0;
            }
            return null; // overflow
        }

        for (const tab of tablets) {
            const slot = nextTabletSlot();
            if (!slot) break;

            slots.push({
                spokeIndex: slot.spoke,
                slotPosition: slot.pos,
                isCapsule: false,
                substanceName: tab.name,
                substanceColor: tab.color,
                dose: tab.dose,
                sourceProtocol: cycleId,
            });

            if (!spokeOccupied.has(slot.spoke)) spokeOccupied.set(slot.spoke, new Set());
            spokeOccupied.get(slot.spoke)!.add(slot.pos);
        }

        return { day, slots };
    });

    _protocols.push({
        cycleId,
        filename,
        addedAt: new Date().toISOString(),
        days,
    });

    persist();
}

/** Remove a protocol from the stream. */
export function removeFromStream(cycleId: string): void {
    load();
    _protocols = _protocols.filter(p => p.cycleId !== cycleId);
    persist();
}

/** Check if a protocol is currently in the stream. */
export function isInStream(cycleId: string): boolean {
    load();
    return _protocols.some(p => p.cycleId === cycleId);
}

/** Get all stream protocols. */
export function getStreamProtocols(): StreamProtocol[] {
    return load();
}

/** Get all slot fills for a specific day (0-27), merged from all protocols. */
export function getDaySlots(day: number): SlotFill[] {
    load();
    const slots: SlotFill[] = [];
    for (const p of _protocols) {
        const dayAlloc = p.days.find(da => da.day === day);
        if (dayAlloc) slots.push(...dayAlloc.slots);
    }
    return slots.sort((a, b) => a.spokeIndex - b.spokeIndex || a.slotPosition - b.slotPosition);
}

/** Summary stats for the header. */
export function getStreamSummary(): { protocols: number; substances: number; cartridges: string } {
    load();
    let substances = 0;
    // A full cartridge = 25 spoke-units.
    // Capsule = 1 spoke-unit (occupies full spoke). Tablet = 1/5 spoke-unit.
    let spokeUnits = 0;
    for (const p of _protocols) {
        for (const da of p.days) {
            substances += da.slots.length;
            for (const s of da.slots) {
                spokeUnits += s.isCapsule ? 1 : 0.2;
            }
        }
    }
    const fullCartridges = spokeUnits / MY_STREAM.substanceSlots;
    const cartridgeStr =
        fullCartridges === 0
            ? '0'
            : fullCartridges >= 1
              ? fullCartridges.toFixed(1).replace(/\.0$/, '')
              : fullCartridges.toFixed(1);
    return { protocols: _protocols.length, substances, cartridges: cartridgeStr };
}

/** Clear all protocols from the stream. */
export function clearStream(): void {
    _protocols = [];
    persist();
}

/** Get/set collapse state. */
export function getStreamCollapsed(): boolean {
    return settingsStore.getBoolean(COLLAPSE_KEY, false);
}

export function setStreamCollapsed(collapsed: boolean): void {
    settingsStore.setString(COLLAPSE_KEY, String(collapsed));
}
