with open("src/styles.css", "r") as f:
    css = f.read()

# I am Antigravity. Safely applying CSS structural rules to fix layout collapsing.

# odometer-wrapper pointer bypass
css = css.replace(".odometer-wrapper {\n    display: flex;", ".odometer-wrapper {\n    display: flex;\n    pointer-events: none;\n    user-select: none;\n    -webkit-user-select: none;")

# odometer-track flow restoration
css = css.replace(".odometer-track {\n    position: absolute;\n    top: 0; left: 0; right: 0;\n    display: flex;", ".odometer-track {\n    display: flex;")

# odometer-word text selection removal
css = css.replace(".odometer-word {\n    height: 18px;\n    line-height: 18px;\n    font-family: 'Space Grotesk', sans-serif;\n    font-size: 13px;\n    font-weight: 400;\n    color: var(--curve-color, #fff);\n    white-space: nowrap;\n    text-align: center;", ".odometer-word {\n    height: 18px;\n    line-height: 18px;\n    font-family: 'Space Grotesk', sans-serif;\n    font-size: 13px;\n    font-weight: 400;\n    color: var(--curve-color, #fff);\n    white-space: nowrap;\n    text-align: center;\n    pointer-events: none;\n    user-select: none;\n    -webkit-user-select: none;")

with open("src/styles.css", "w") as f:
    f.write(css)

with open("styles.css", "r") as f:
    css = f.read()

# odometer-wrapper pointer bypass
css = css.replace(".odometer-wrapper {\n    display: flex;", ".odometer-wrapper {\n    display: flex;\n    pointer-events: none;\n    user-select: none;\n    -webkit-user-select: none;")

# odometer-track flow restoration
css = css.replace(".odometer-track {\n    position: absolute;\n    top: 0; left: 0; right: 0;\n    display: flex;", ".odometer-track {\n    display: flex;")

# odometer-word text selection removal
css = css.replace(".odometer-word {\n    height: 18px;\n    line-height: 18px;\n    font-family: 'Space Grotesk', sans-serif;\n    font-size: 13px;\n    font-weight: 400;\n    color: var(--curve-color, #fff);\n    white-space: nowrap;\n    text-align: center;", ".odometer-word {\n    height: 18px;\n    line-height: 18px;\n    font-family: 'Space Grotesk', sans-serif;\n    font-size: 13px;\n    font-weight: 400;\n    color: var(--curve-color, #fff);\n    white-space: nowrap;\n    text-align: center;\n    pointer-events: none;\n    user-select: none;\n    -webkit-user-select: none;")

with open("styles.css", "w") as f:
    f.write(css)

print("done css rep")
