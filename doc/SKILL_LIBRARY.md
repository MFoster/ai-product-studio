# 3D print skill library

AI Product Studio uses narrow, composable skills. The Blender expert agent or a
product-line agent should load only the skills needed for the current stage
rather than treating one oversized skill as a complete workflow.

## Core global skills

| Skill | Primary responsibility |
|---|---|
| `mesh-printability-audit` | Mesh health, repair evidence, scale, and export re-import checks |
| `fit-tolerance-engineering` | Mating clearances, assembly paths, coupons, and fit evidence |
| `wall-strength-engineering` | Load paths, wall sections, joints, loops, and reinforcement |
| `support-free-orientation` | Component orientation, overhang redesign, bridges, and supports |
| `fdm-detail-design` | Nozzle-aware relief, text, texture, gaps, and silhouette |
| `curved-surface-relief` | Consistent relief wrapping on curved and irregular shells |
| `ams-multipart-color` | Color-separated intersecting components and AMS mapping |
| `threaded-container-mechanism` | Hollow shells, threaded closures, cavity, and split design |
| `organic-character-detail` | Expressive printable figures, animals, anatomy, and pose |
| `procedural-decoration-system` | Reproducible foliage, wreaths, garlands, ribbons, and borders |
| `model-repair-from-stl` | Measured repair when editable source geometry is unavailable |
| `3mf-release-packaging` | Named STL export, 3MF assembly, inventory, and release evidence |
| `test-print-feedback-loop` | Measured physical-print feedback and controlled revisions |
| `catalog-render-and-review` | Consistent renders and cross-catalog visual review |
| `bambu-plate-planning` | Bambu Studio layout, AMS, support, seam, and slice review |

Product-line-specific art direction remains under
`product-line/<line>/ai/skill/` and is synchronized into `.github/skills/`.

## Recommended execution order

1. Product brief and product-line style skill.
2. Mechanism, fit, and strength skills.
3. Organic, procedural, relief, and FDM detail skills.
4. AMS separation and support-free orientation.
5. Mesh printability audit.
6. Catalog render and visual review.
7. STL and 3MF release packaging.
8. Bambu plate planning and sliced-layer review.
9. Physical test print and feedback loop.

Earlier skills may be revisited when a later gate exposes a conflict. For
example, support-free orientation can require changes to wall strength or relief.

## Composition recipes

### Decorative threaded ornament

- `threaded-container-mechanism`
- `fit-tolerance-engineering`
- `wall-strength-engineering`
- Product-line decorative skill
- `organic-character-detail` when the subject includes figures or animals
- `procedural-decoration-system`
- `curved-surface-relief`
- `fdm-detail-design`
- `ams-multipart-color`
- `support-free-orientation`
- `mesh-printability-audit`
- `catalog-render-and-review`
- `3mf-release-packaging`
- `bambu-plate-planning`
- `test-print-feedback-loop`

### Imported STL functional repair

- `model-repair-from-stl`
- `fit-tolerance-engineering`
- `wall-strength-engineering`
- `mesh-printability-audit`
- `support-free-orientation`
- `3mf-release-packaging`
- `test-print-feedback-loop`

### Decorative freestanding character

- `organic-character-detail`
- `fdm-detail-design`
- `wall-strength-engineering`
- `support-free-orientation`
- `ams-multipart-color`
- `mesh-printability-audit`
- `catalog-render-and-review`
- `3mf-release-packaging`

### Catalog variant or seasonal refresh

- Existing product-line style skill
- `procedural-decoration-system`
- `fdm-detail-design`
- `ams-multipart-color`
- `catalog-render-and-review`
- Reliability skills affected by changed geometry

## Evidence boundaries

Skills must distinguish these claims:

- **Geometry validated:** source meshes and dimensions pass model checks.
- **Package validated:** exported assets retain scale, alignment, and component structure.
- **Slice reviewed:** Bambu Studio toolpaths, supports, seams, and AMS assignments were inspected.
- **Physically validated:** a traceable printed version met recorded acceptance criteria.

No earlier result implies a later one.
