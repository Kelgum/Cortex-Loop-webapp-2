with open("src/styles.css", "r") as f:
    css = f.read()

# Fix odometer-slot min-width and odometer-track flow
css = css.replace(".odometer-slot {\n    position: relative;\n    height: 18px;\n    overflow: hidden;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n}", ".odometer-slot {\n    position: relative;\n    height: 18px;\n    min-width: 48px;\n    overflow: hidden;\n    display: block;\n}")

css = css.replace(".odometer-track {\n    position: absolute;\n    top: 0;\n    left: 0;\n    right: 0;\n    display: flex;", ".odometer-track {\n    position: absolute;\n    width: 100%;\n    top: 0;\n    display: flex;")

with open("src/styles.css", "w") as f:
    f.write(css)

with open("styles.css", "r") as f:
    css = f.read()

css = css.replace(".odometer-slot {\n    position: relative;\n    height: 18px;\n    overflow: hidden;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n}", ".odometer-slot {\n    position: relative;\n    height: 18px;\n    min-width: 48px;\n    overflow: hidden;\n    display: block;\n}")

css = css.replace(".odometer-track {\n    position: absolute;\n    top: 0;\n    left: 0;\n    right: 0;\n    display: flex;", ".odometer-track {\n    position: absolute;\n    width: 100%;\n    top: 0;\n    display: flex;")

with open("styles.css", "w") as f:
    f.write(css)

print("done width repair")
