import re
with open("src/baseline-editor.ts", "r") as f:
    code = f.read()

# I am Antigravity. Just fixing a missing export/import so baseline-editor.ts can compile after modifying its internal structure.
code = code.replace("function getLevelData(curve: any, val: number): OdometerLevel {", "export function getLevelData(curve: any, val: number): OdometerLevel {")
with open("src/baseline-editor.ts", "w") as f:
    f.write(code)

print("done format baseline")
