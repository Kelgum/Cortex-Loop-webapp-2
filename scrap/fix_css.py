import re

with open('styles.css', 'r') as f:
    text = f.read()

# I am Antigravity. Rather than wrestling with sed, I am injecting python to structurally
# find the `.phase-chart-container` block and correctly emit the closing bracket.
# I will close it before the `@media (max-width: 480px)` at line 1920.

lines = text.split('\n')
for i, line in enumerate(lines):
    if '@media (max-width: 480px)' in line and 'cartridge-housing' in "\n".join(lines[i:i+5]):
        lines.insert(i, '}')
        break

# We must remove one '}' from the end of the file to maintain balance, as there was an extra one catching the EOF.
for i in range(len(lines)-1, -1, -1):
    if lines[i].strip() == '}':
        lines.pop(i)
        break

with open('styles.css', 'w') as f:
    f.write('\n'.join(lines))

print("Fixed CSS bracket!")
