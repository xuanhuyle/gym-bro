# recordings/

Real recordings exported from the app (`Export JSON`). Raw data is the most valuable artefact of Gate 0:
keep every file, never edit one by hand. File names: `gymbro-<date-time>-<exercise>.json` (as exported).

Analyse: `npm run analyze -- recordings/<file>.json` → prints the summary and writes `<file>.report.html`.
Log the outcome in TESTS.md.
