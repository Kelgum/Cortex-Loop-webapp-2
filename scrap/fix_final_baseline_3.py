import re
with open("src/phase-chart.ts", "r") as f:
    code = f.read()

# Make sure getLevelData gets imported, because my earlier script may have failed to regex replace it correctly.
code = code.replace("import { activateBaselineEditor, cleanupBaselineEditor } from './baseline-editor';", "import { activateBaselineEditor, cleanupBaselineEditor, getLevelData } from './baseline-editor';")

with open("src/phase-chart.ts", "w") as f:
    f.write(code)

