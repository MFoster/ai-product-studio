---
name: wall-strength-engineering
description: Evaluate and reinforce FDM walls, loops, hooks, cantilevers, joints, and load paths. Use when a model must survive handling, hanging, repeated assembly, impact, or sustained loads.
---

# Wall and Strength Engineering

## Use this skill when

A printable model has structural responsibilities or contains thin, tall, hanging, flexible, or repeatedly handled features.

## Required inputs

- Expected loads, directions, and frequency.
- Material and intended print orientation.
- Nozzle size, wall count assumptions, and dimensional limits.
- Areas that must remain flexible, hollow, lightweight, or decorative.

## Workflow

1. Identify load application points, supports, joints, and complete load paths.
2. Measure wall thickness and cross-sections at transitions, holes, necks, roots, and layer-sensitive regions.
3. Compare forces to layer direction and identify peeling or delamination risks.
4. Replace abrupt thickness changes and sharp internal corners with gradual transitions and fillets.
5. Add ribs, gussets, thicker roots, broader contact areas, or redundant paths where needed.
6. Protect cavity volume and appearance while reinforcing hidden or low-visibility areas first.
7. Recheck print orientation, overhangs, and component clearances after reinforcement.

## Quality gates

- No structural wall is below the printer/material minimum without an explicit exception.
- Hanging loops and hooks have reinforced roots and favorable layer direction.
- Load paths do not terminate in thin decorative shells.
- Stress concentrations and sharp internal corners are addressed.
- Reinforcement does not block assembly, cavity use, or support-free printing.

## Output contract

Provide a structural-risk map, minimum measured sections, reinforcement changes, assumed loads, orientation rationale, and physical test recommendation.

## Do not claim

Do not assign a certified load rating without material data, controlled print parameters, and destructive physical testing.
