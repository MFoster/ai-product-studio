---
name: calibration-coupon-design
description: Design, label, and interpret small printed test coupons that qualify a fit, clearance, or process value before committing a full part. Use when a dimension is uncertain, a fit has failed, or a model value needs physical evidence.
---

# Calibration Coupon Design

## Use this skill when

A model carries a dimension that cannot be trusted from CAD alone — a clearance,
a seat, a retention feature, a bridge, a wall — and printing the whole product to
find out would be slow, expensive, or destructive.

Pair with `fit-tolerance-engineering` to choose the values to bracket, and with
`test-print-feedback-loop` to convert the result into a revision.

## The governing rule

**A coupon only qualifies what it actually reproduces.** Every attribute of the
real feature that the coupon simplifies away is an attribute the coupon cannot
speak for. A passed coupon is evidence about the coupon; it is evidence about
the product only to the extent the two are the same article.

Most coupon failures are not wrong measurements. They are correct measurements
of the wrong thing, which then carry false authority into the next version.

## Required inputs

- The exact feature being qualified and its mating partner.
- The print orientation of **both** halves in the real product.
- The one parameter family being varied, and a bracket of candidate values.
- Printer, nozzle, layer height, material, and slicer preset.
- The acceptance test, written as a physical action with a reportable outcome.

## Workflow

### 1. Reproduce the feature, not an abstraction of it

Match, in order of importance:

1. **Print orientation of each half.** This is the attribute most often lost and
   the most damaging to lose. Mating halves frequently print on *different*
   axes; the coupon must reproduce each half on its own axis.
2. **Feature geometry.** A blind tilted seat is not a vertical through-bore. A
   bore in a thin wall is not a bore in a solid block.
3. **Full cross-section.** Fit error scales with dimension, so a reduced-scale
   socket under-reports it.
4. **Feature count and constraint.** If N features must engage simultaneously on
   the real part, a one-feature coupon cannot expose positional stack-up or
   over-constraint. Either reproduce the count, or record explicitly that the
   coupon does not cover it.

Simplify engagement depth and bulk material freely to keep the coupon cheap —
but see step 5, because depth changes which properties transfer.

### 2. Vary exactly one parameter family

Hold everything else at the production value. If two things change, a pass tells
you nothing about which one earned it.

### 3. Bracket so the result is bounded on both sides

Choose values that straddle the expected answer. **If the selected value lands
at an end of the bracket, the value is not bounded**, and the bracket should be
re-run shifted. A result is strongest when the neighbours on both sides fail in
opposite directions — too tight on one side, too loose on the other.

### 4. Label every piece, physically

The reporting path is part of the experiment. A coupon that cannot be identified
in the hand produces an ambiguous report, and an ambiguous report silently
corrupts the revision that follows.

- **Emboss the varied value on every piece**, including each loose plug, key or
  insert — not only on the block.
- Print the **actual value** ("0.20"), not an index, a letter, or an unrelated
  dimension. Never name a piece after a dimension that is not the variable: a
  coupon set named by key *length* while nib *height* was the variable produced
  a transposed results table that had to be corrected afterwards.
- Sizing for a 0.4 mm nozzle: raised text, stroke ≥ 0.8 mm (two extrusion
  widths), relief 0.4–0.6 mm (2–3 layers), character height ≥ 4 mm. Raised text
  survives small sizes better than engraved.
- Place labels on a face that prints without support, is not a mating surface,
  and faces the user when the coupon is handled.
- Keep the label convention identical across versions so results stay
  comparable.

### 5. Declare what the coupon does and does not transfer

Write this down before printing. Clearance, orientation quality and feature
geometry transfer. Anything that scales with a dimension the coupon shortened
does **not**:

| Property | Transfers from a shortened coupon? |
|---|---|
| Clearance / fit | Yes — a cross-section property |
| Insertion and removal **force** | **No** — friction scales with engagement length |
| Positional stack-up | No — needs the real feature count and spacing |
| Retention force | No — unless the retention feature is reproduced whole |
| Bridging and overhang quality | Only at the same span and orientation |

Where a property does not transfer, either reproduce it or mitigate it in the
design — for example, a lead-in chamfer where insertion force is unproven.

### 6. Make every coupon piece removable

A plug, key or insert that cannot be taken back out ends the experiment early
and can destroy the remaining data points. Design the exit path deliberately:

- Leave loose pieces **proud of the pocket by ≥ 3 mm**, or add a flange, tab,
  knurl or finger relief. A piece flush with its pocket has nothing to grip.
- Or provide a **push-out hole** through the back of a blind pocket.
- Add a vent or relief groove to blind pockets so trapped air does not resist
  extraction.
- Apply the same requirement to the **product**: any key, insert or captured
  part needs a hand-accessible removal path, and retention force must be treated
  as a separate design quantity from extraction accessibility. A feature strong
  enough to hold is not automatically possible to release.

When a piece does get stuck, diagnose whether the cause is the fit or the
coupon's own ergonomics before changing a production value.

### 7. Write the acceptance test as an action

State the physical motion and the outcome to report. "Does it fit" is not a
test. "Seat it, invert it, shake it, then release it by hand" is.

Test the quantity that matters, not a proxy for it. Swept interference volume is
not push force. Seating is not holding. Insertion is not removal.

### 8. Record and preserve

Capture printed version, printer, material, nozzle, layer height and slicer
preset alongside the result, in the owner's own words where possible. Keep
failed and superseded coupons as evidence; they are the provenance chain behind
every production value, and a later version will need to re-read them.

## Quality gates

- The coupon reproduces both halves in their production print orientations.
- Exactly one parameter family varies.
- The selected value is interior to the bracket, not at an end.
- Every piece carries an embossed label of its own varied value.
- Every loose piece has a deliberate, hand-accessible removal path.
- The acceptance test is a physical action with a reportable outcome.
- Properties the coupon cannot transfer are written down before printing.
- The profile is recorded with the result.

## Output contract

Provide the feature under test, the simplifications made and their consequences,
the bracket and its rationale, per-piece labels, the print orientation of each
piece with justification, the acceptance test as an action, the list of
properties that do not transfer, and the decision rule for selecting a value.

## Do not claim

Do not treat a passed coupon as qualifying the assembled product. Do not carry a
coupon result across a change of orientation, scale, feature count, or
engagement depth without stating which properties survive the change. Do not
convert "it seated" into "it is retained", or "it inserted" into "it can be
removed".
