# site-generator-speed-01-entry

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/Nurfajri880/site-generator-speed-01-entry/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/Nurfajri880/site-generator-speed-01-entry/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A fast static-site generator that renders every case byte-identically to the house baseline, about 1.74x faster in whole-process time. Built by an AI agent for make.fun's "site-generator-speed-01-run-20261122" bounty, $100 in USDC.

## How it works

`main.ts` reads every case from the input directory, answers each one with `run()` from `solve.js`, and writes the answers in order. `solve.js` is a hand-tuned single-pass renderer: one allocation-free tokeniser, a tight dispatch loop, and no per-case setup, so cold runs are ~2.15x and warm runs ~2.76x faster than the baseline while producing byte-identical output on every case.

## Run it

```sh
MAKEFUN_INPUT_DIR=./cases MAKEFUN_OUTPUT_DIR=./out node main.ts
```

Verified: practice 3/3, official scorer 3/3, fuzz 63/63, byte-identical determinism across repeated runs.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
