---
name: test-print-feedback-loop
description: Convert measured physical test-print results into controlled model and profile revisions. Use when correcting fit, strength, elephant foot, detail loss, stringing, color bleed, support scars, or repeated print failures.
---

# Test Print Feedback Loop

## Use this skill when

A physical prototype has been printed and its observed behavior must drive the next model version.

## Required inputs

- Model and package version that was printed.
- Printer, material, nozzle, layer height, and slicer profile.
- Photos, measurements, failure locations, and user observations.
- Intended acceptance criteria.

## Workflow

1. Link every observation to the exact source, package, and profile version.
2. Separate geometry causes from slicer, material, calibration, and handling causes.
3. Record measured error magnitude and direction instead of vague descriptions.
4. Change one parameter family at a time when practical.
5. Prefer calibration coupons for fit or process uncertainty before reprinting the entire product.
6. Update tunable source parameters and document the hypothesis behind each change.
7. Generate a new version, repeat the same measurements, and compare results.
8. Preserve failed results as evidence rather than overwriting them.

## Quality gates

- Feedback identifies an exact printed version and profile.
- Measurements are recorded with units and locations.
- Each revision has an explicit hypothesis and changed parameter.
- Acceptance criteria are tested consistently across iterations.
- Physical print status remains failed or pending until the criteria pass.

## Output contract

Provide observation table, root-cause classification, measured deviations, revision parameters, coupon or reprint plan, and updated workflow evidence.

## Do not claim

Do not convert subjective approval or an unmeasured visual impression into a passed engineering validation.
