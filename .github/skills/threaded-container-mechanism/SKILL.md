---
name: threaded-container-mechanism
description: Design hollow printable containers with reliable lids, threads, lead-ins, stops, cavities, and hanging features. Use for ornaments, capsules, boxes, jars, or reusable gift containers.
---

# Threaded Container Mechanism

## Use this skill when

A printable product opens and closes with threads or a rotational locking interface while preserving useful internal capacity.

## Required inputs

- Overall envelope and required cavity volume.
- Split location and allowed visible seam.
- Printer, material, orientation, and fit calibration.
- Required starts, turns, retention, and opening force.

## Workflow

1. Establish shell thickness, opening diameter, cavity, and split before decorating.
2. Select thread form, lead, pitch, starts, engagement length, and rotation limit.
3. Parameterize male and female profiles from a shared nominal interface.
4. Apply radial and axial clearance based on fit calibration.
5. Add lead-ins, runout, end relief, stops, and grip surfaces.
6. Keep decoration and cavity geometry away from the thread envelope.
7. Test the closed position with boolean intersection and verify the full motion path.
8. Orient each half for stable, support-minimized printing and compensate for first-layer effects.

## Quality gates

- Zero unintended male/female intersection in the closed test position.
- Adequate engagement without bottoming out prematurely.
- Shell thickness remains valid around the thread and opening.
- Cavity meets the required usable dimensions.
- Both halves have documented print orientations and accessible assembly.

## Output contract

Report thread parameters, clearances, engagement, cavity dimensions, split location, closed-position interference result, and required test-print coupon or prototype.

## Do not claim

Do not call a thread production-ready until a representative physical print has been opened and closed repeatedly.
