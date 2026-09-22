---
name: fit-tolerance-engineering
description: Engineer repeatable FDM clearances for pins, sockets, hinges, sliding parts, press fits, snap fits, magnets, and mating assemblies. Use when parts must connect, move, retain, or separate reliably after printing.
---

# Fit and Tolerance Engineering

## Use this skill when

Two or more printed or purchased parts must mate with controlled looseness, retention, motion, or assembly force.

## Required inputs

- Nominal mating dimensions and fit type.
- Printer, nozzle, layer height, material, and print orientation.
- Whether parts print together or separately.
- Available calibration results and acceptable play or force.

## Workflow

1. Classify each interface as clearance, sliding, rotational, press, snap, threaded, or hardware fit.
2. Establish datum surfaces and separate nominal geometry from clearance parameters.
3. Account for XY expansion, Z stair stepping, elephant foot, hole shrinkage, and anisotropy.
4. Use repository calibration values when available; otherwise create a small stepped coupon before changing the production model.
5. Add lead-ins, chamfers, relief channels, end stops, and accessible assembly paths.
6. Verify full insertion depth, retention engagement, motion envelope, and collision-free assembly.
7. Preserve tunable parameters in the Blender source or generation script.

## Quality gates

- Clearance is explicit and measured on both mating parts.
- Assembly has an unobstructed insertion and removal path.
- Pins and sockets have adequate wall thickness around them.
- Snap features respect material strain and layer direction.
- A calibration coupon or physical fit result supports final production values.

## Output contract

Report interface type, nominal dimensions, applied XY/Z clearances, orientation assumptions, coupon recommendation, assembly sequence, and remaining test-print requirement.

## Do not claim

Do not guarantee a fit from nominal CAD dimensions alone. Printer, material, orientation, and first-layer behavior can change the result.
