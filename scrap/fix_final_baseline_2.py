import re
with open("src/phase-chart.ts", "r") as f:
    code = f.read()

import_pattern = r"(import \{.*?\} from './baseline-editor';)"
match = re.search(import_pattern, code)
if match:
   imp_str = match.group(0)
   new_imp = imp_str.replace("}", ", getLevelData }")
   code = code.replace(imp_str, new_imp)

code = code.replace("export function getChartLevelDesc(curve: any, val: number): string {\n    const levelVal = nearestLevel(val);\n    if (Array.isArray(curve.levels)) {\n        let best = curve.levels[0];\n        if (best) {\n            for (const l of curve.levels) {\n                if (Math.abs(l.intensity_percent - val) < Math.abs(best.intensity_percent - val)) best = l;\n            }\n            return `${best.slot_1} ${best.slot_2} ${best.slot_3}`;\n        }\n    }\n    return curve.levels?.[String(levelVal)] || '';\n}", "export function getChartLevelDesc(curve: any, val: number): string {\n    const levelVal = nearestLevel(val);\n    if (Array.isArray(curve.levels)) {\n        let best = getLevelData(curve, val);\n        if (best) return `${best.slot_1} ${best.slot_2} ${best.slot_3}`;\n    }\n    return curve.levels?.[String(levelVal)] || '';\n}")

with open("src/phase-chart.ts", "w") as f:
    f.write(code)

