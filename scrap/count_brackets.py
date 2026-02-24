with open("styles.css", "r") as f:
    text = f.read()

lines = text.split("\n")
opens = 0
closes = 0

stack = []

for i, line in enumerate(lines):
    for char in line:
        if char == "{":
            opens += 1
            stack.append(i + 1)
        elif char == "}":
            closes += 1
            if stack:
                stack.pop()
            else:
                print(f"Extra closing bracket at line {i + 1}")

print(f"Opens: {opens}, Closes: {closes}")
if stack:
    print(f"Unclosed brackets opened at lines: {stack}")
