# Architecture decision records

One file per decision: `NNNN-short-title.md`, numbered in order and never renumbered.
Claude writes them; the owner accepts them by merging the PR that adds them.

Use an ADR when a change adds infrastructure or a dependency, changes a boundary
(worker ↔ gateway ↔ SQL ↔ web), introduces a pattern the rest of the code should follow, or
reverses an earlier decision. `docs/decisions.md` stays as the historical log; new decisions go here.

Template:

```
# NNNN. Title
Status: proposed | accepted | superseded by NNNN
Date: YYYY-MM-DD

## Context
What forces the decision, with evidence.

## Decision
What we will do.

## Consequences
What gets easier, what gets harder, what we'll watch.
```

| # | Title | Status |
| --- | --- | --- |
| 0001 | Agent team operating model | proposed |
| 0002 | Switchable CI runner (hosted by default, self-hosted on demand) | proposed |
| 0003 | Hashed audience identities, kept 30 days, shown only above thresholds | proposed |
| 0004 | Edge functions deploy from main, in the gated deploy job | proposed |
