import re

content = ""
with open("src/baseline-editor.ts", "r") as f:
    content = f.read()

# I will script the replacement using python safely.
