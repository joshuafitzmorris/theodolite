# Decisions
Append-only. One line each: `- YYYY-MM-DD D1 | decision: ... | alternative: ... | reverse: ...`
Agents append; the human edits or supersedes. Number D1, D2, ... in order.

- 2026-10-10 D1 | decision: a write whose target cannot be extracted is attributed to the first resource of its kind that lists the file by glob | alternative: always report `?` and require an exact path | reverse: drop the kind-match branch in src/scan/resolve.ts
