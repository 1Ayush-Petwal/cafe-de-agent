# Slot-grid form trust: normalize days-ahead input and explain created-vs-skipped days

> Local mirror of [1Ayush-Petwal/Project-1/issues/16](https://github.com/1Ayush-Petwal/Project-1/issues/16) — GitHub is the source of truth. Label: `ready-for-agent`.

## Parent

1Ayush-Petwal/Project-1#15 (PRD: Kaforia — work area A)

## What to build

Make the owner slot-grid form trustworthy. The "days ahead" field normalizes what the owner types purely client-side: leading zeros stripped on change, value clamped to the API's existing 1–60 bounds — the number displayed is exactly the number submitted. The generation result message changes from a bare count to a created-vs-skipped explanation: "Created N slots across D new days (K days already had slots — skipped)." The generation endpoint returns (or the client derives) enough information to state the day split. The backend generation logic is untouched — it was verified correct during the grilling investigation (the infamous `014` → "104 slots" was 14 days × 13 slots/day minus 6 already-populated days).

## Acceptance criteria

- [ ] Typing `014` into days-ahead displays `14`; out-of-range values clamp to 1–60
- [ ] Result message states slots created, new days covered, and days skipped because they already had slots
- [ ] Generating over a range where some days already have slots reads as expected behavior, not a malfunction
- [ ] Slot-generation backend behavior unchanged (existing e2e specs still pass)
- [ ] Frontend verified manually (no web test runner — per PRD testing decisions)

## Blocked by

None - can start immediately
