with open("styles.css", "r") as f:
    text = f.read()

lines = text.split("\n")
opens = 0
closes = 0

stack = []

for i, line in enumerate(lines):
    for char in line:
        if char == "{":
            stack.append(i + 1)
        elif char == "}":
            if stack:
                stack.pop()
            else:
                print(f"Extra closing bracket at line {i + 1}")

if stack:
    print(f"Unclosed blocks at lines: {stack}")
else:
    print("Perfectly balanced.")
