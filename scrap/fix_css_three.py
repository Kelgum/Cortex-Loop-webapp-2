with open("src/styles.css", "r") as f:
    css = f.read()

# I am completely overriding odometer-flexters and odometer-slot to guarantee horizontal alignment
# display: flex + flex-direction: row + white-space: nowrap + flex-wrap: nowrap + 0 flex-shrink

css = css.replace(""".odometer-flexters {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: rgba(20, 25, 35, 0.85);
    backdrop-filter: blur(8px);
    border-radius: 12px;
    padding: 6px 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}""", """.odometer-flexters {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: nowrap !important;
    white-space: nowrap !important;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: rgba(20, 25, 35, 0.85);
    backdrop-filter: blur(8px);
    border-radius: 12px;
    padding: 6px 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}""")

css = css.replace(""".odometer-slot {
    position: relative;
    height: 18px;
    min-width: 48px;
    overflow: hidden;
    display: block;
}""", """.odometer-slot {
    position: relative;
    height: 18px;
    min-width: 48px;
    overflow: hidden;
    display: block;
    flex: 0 0 auto !important;
}""")

css = css.replace(""".odometer-dot {
    color: var(--text-muted);
    font-size: 14px;
    line-height: 18px;
}""", """.odometer-dot {
    color: var(--text-muted);
    font-size: 14px;
    line-height: 18px;
    flex: 0 0 auto !important;
}""")

with open("src/styles.css", "w") as f:
    f.write(css)


with open("styles.css", "r") as f:
    css = f.read()

css = css.replace(""".odometer-flexters {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: rgba(20, 25, 35, 0.85);
    backdrop-filter: blur(8px);
    border-radius: 12px;
    padding: 6px 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}""", """.odometer-flexters {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: nowrap !important;
    white-space: nowrap !important;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: rgba(20, 25, 35, 0.85);
    backdrop-filter: blur(8px);
    border-radius: 12px;
    padding: 6px 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}""")

css = css.replace(""".odometer-slot {
    position: relative;
    height: 18px;
    min-width: 48px;
    overflow: hidden;
    display: block;
}""", """.odometer-slot {
    position: relative;
    height: 18px;
    min-width: 48px;
    overflow: hidden;
    display: block;
    flex: 0 0 auto !important;
}""")

css = css.replace(""".odometer-dot {
    color: var(--text-muted);
    font-size: 14px;
    line-height: 18px;
}""", """.odometer-dot {
    color: var(--text-muted);
    font-size: 14px;
    line-height: 18px;
    flex: 0 0 auto !important;
}""")


with open("styles.css", "w") as f:
    f.write(css)

print("done force")
