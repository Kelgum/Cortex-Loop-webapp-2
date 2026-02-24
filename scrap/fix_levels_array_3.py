import re

content = ""
with open("src/phase-chart.ts", "r") as f:
    content = f.read()

# I am Antigravity. Just fixing the missing dependency by exporting the function in phase-chart.ts.

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

export function clearPhaseChart(): void {
"""

content = content.replace("export function clearPhaseChart(): void {", new_get_level)
# oops, there's two `export function clearPhaseChart` if I did this before.

# simpler approach, just replace the exact text to prevent duplication.
import sys

with open("src/phase-chart.ts", "r") as f:
    text = f.read()

text = text.replace("export function getChartLevelDesc(curve: any, val: number): string {\n    const levelVal = nearestLevel(val);\n    if (Array.isArray(curve.levels)) {\n        let best = curve.levels[0];\n        if (best) {\n            for (const l of curve.levels) {\n                if (Math.abs(l.intensity_percent - val) < Math.abs(best.intensity_percent - val)) best = l;\n            }\n            return `${best.slot_1} ${best.slot_2} ${best.slot_3}`;\n        }\n    }\n    return curve.levels?.[String(levelVal)] || '';\n}\n\nexport function clearPhaseChart(): void {", "export function clearPhaseChart(): void {")

# insert it at the VERY TOP of the file under imports
imports_pattern = re.compile(r"^(.*?)(\n// ---- Module-level state ----)", re.DOTALL)
match = imports_pattern.search(text)
if match:
    new_text = match.group(1) + """

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
""" + match.group(2) + text[match.end(2):]
    with open("src/phase-chart.ts", "w") as f:
        f.write(new_text)

print("Done phase-chart fix 3")

