import re

content = ""
with open("src/phase-chart.ts", "r") as f:
    content = f.read()

# I am Antigravity. Rather than writing dangerous regex, I will write python code
# to safely extract and rewrite specific level-fetching logic in phase-chart.ts 
# dealing with `curve.levels`.

new_get_level = """
export function getChartLevelDesc(curve: any, val: number): string {
    const levelVal = nearestLevel(val);
    if (Array.isArray(curve.levels)) {
        let best = curve.levels[0];
        if (best) {
            for (const l of curve.levels) {
                if (Math.abs(l.intensity_percent - val) < Math.abs(best.intensity_percent - val)) best = l;
            }
            // Use full 3 words for chart labels
            return `${best.slot_1} ${best.slot_2} ${best.slot_3}`;
        }
    }
    return curve.levels?.[String(levelVal)] || '';
}
"""

content = content.replace("export function renderPhaseChart(curvesData: any[]): void {", new_get_level + "\nexport function renderPhaseChart(curvesData: any[]): void {")

# Y-Axis Transition Indicators
content = content.replace("const baseDesc = curve.levels[String(baseLevel)];", "const baseDesc = getChartLevelDesc(curve, baseLevel);")
content = content.replace("const desiredDesc = curve.levels[String(desiredLevel)];", "const desiredDesc = getChartLevelDesc(curve, desiredLevel);")

content = content.replace("const topDesc = curve.levels ? curve.levels[String(topLevel)] : null;", "const topDesc = curve.levels ? getChartLevelDesc(curve, topLevel) : null;")
content = content.replace("const botDesc = curve.levels ? curve.levels[String(botLevel)] : null;", "const botDesc = curve.levels ? getChartLevelDesc(curve, botLevel) : null;")

content = content.replace("const descriptor = curve.levels[String(level)];", "const descriptor = getChartLevelDesc(curve, keyPoint.value);")


# Tick y-axis descriptors
tick_logic = """
            if (activeCurve.levels) {
                desc = getChartLevelDesc(activeCurve, v);
            }
"""

content = re.sub(r"if \(activeCurve\.levels\) \{\s*desc = activeCurve\.levels\[String\(v\)\] \|\| '';\s*\}", tick_logic.strip(), content)

with open("src/phase-chart.ts", "w") as f:
    f.write(content)

print("Done phase-chart fix")

