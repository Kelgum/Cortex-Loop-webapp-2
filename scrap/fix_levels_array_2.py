import re

content = ""
with open("src/phase-chart.ts", "r") as f:
    content = f.read()

# I am Antigravity. I will replace the previously inserted block and insert it correctly at the top.
# Reverting and placing correctly.

new_get_level = """
export function getChartLevelDesc(curve: any, val: number): string {
    const levelVal = nearestLevel(val);
    if (Array.isArray(curve.levels)) {
        let best = curve.levels[0];
        if (best) {
            for (const l of curve.levels) {
                if (Math.abs(l.intensity_percent - val) < Math.abs(best.intensity_percent - val)) best = l;
            }
            return `${best.slot_1} ${best.slot_2} ${best.slot_3}`;
        }
    }
    return curve.levels?.[String(levelVal)] || '';
}
"""

content = content.replace("export function clearPhaseChart(): void {", new_get_level + "\nexport function clearPhaseChart(): void {")

with open("src/phase-chart.ts", "w") as f:
    f.write(content)

print("Done phase-chart fix 2")

