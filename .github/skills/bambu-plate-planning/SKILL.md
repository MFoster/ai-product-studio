---
name: bambu-plate-planning
description: Plan Bambu Studio plate layout, orientation, object grouping, AMS assignment, and manual slice review. Use when preparing a validated model for efficient printing on a Bambu printer.
---

# Bambu Plate Planning

## Use this skill when

Validated components must be arranged and reviewed in Bambu Studio before a test or production print.

## Required inputs

- Validated 3MF or STL component set.
- Target Bambu printer, plate, nozzle, and material profiles.
- AMS palette and component mapping.
- Surface quality, strength, and support priorities.

## Workflow

1. Confirm package units, component names, and intended orientation metadata.
2. Arrange components with adequate spacing, stable footprints, and sensible cooling order.
3. Preserve strength-sensitive layer orientation and critical cosmetic surfaces.
4. Assign AMS filaments and inspect purge volume, transition frequency, and incompatible material combinations.
5. Select supports, brims, seams, and variable layer height deliberately.
6. Slice and inspect every layer around thin details, bridges, color boundaries, threads, and first-layer interfaces.
7. Record estimated time, material, purge, support, and plate configuration.
8. Save a versioned package or project without overwriting released artifacts.

## Quality gates

- Every object is on the intended plate and within build volume.
- No component is unintentionally rescaled or auto-arranged into a weak orientation.
- AMS assignments match the approved component map.
- Sliced toolpaths contain all critical features.
- Supports, seams, brims, and purge behavior have been reviewed.

## Output contract

Provide plate screenshot or project, orientation table, AMS mapping, support and seam decisions, slice estimates, identified risks, and test-print status.

## Do not claim

Do not call a plate production-ready without inspecting sliced layers; model-space appearance is not sufficient.
