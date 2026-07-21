# 3D Parallel Finishing — Toolpath Math

*Session: Telegram, 2026-07-13*

---

## Undercut Analysis on XZ Slice Contours

For a bit approaching from +Z, treat each XZ slice as a 2D **configuration-space** problem:

1. Transform the slice into 2D coordinates: `u=x`, `v=z`; +v is the approach direction.
2. Build the closed-polygon solid `S`.
3. Build two tool silhouettes:
   - **collision profile**: radius, flute length, shank, and optionally holder.
   - **cutting profile**: only the bottom/flute surfaces that may touch material.
4. Inflate the solid by the reflected collision profile:

```
blocked_tool_centers = S ⊕ (-tool_collision_profile)
```

A point in this shape is a tool-tip-center position that would collide.

5. Flood-fill the complement from the top edge. That gives every tool-center position reachable from +Z.
6. Sweep the cutting profile through those reachable centers. Where that sweep touches the original slice boundary is **accessible**; remaining boundary segments are undercuts.

For a flat end mill, its 2D collision profile is roughly a rectangle: `width = diameter`, from the tip upward through flute/shank length. A ball end adds a semicircle at the bottom.

For a first version, rasterize each slice and use SciPy morphology + flood fill; it is simple and robust. Grid resolution is the accuracy knob. Color accessible versus undercut curve segments, then transform them back into XZ.

**Important:** one XZ slice is a **sectional** result—it can falsely report an undercut if the real tool could route around it in Y. True 3D accessibility needs a 3D configuration-space analysis.

## Why 3D Differs from Sectional Analysis

A single XZ slice assumes the tool center is trapped in that plane: it can move only in X and Z.

Real 3-axis milling lets the tool move in **X, Y, and Z**. So a slice can lie:

- **False undercut:** at `Y=0`, a roof appears to block a feature from above. But there may be an opening at `Y=20`; the tool enters there, moves sideways in Y beneath the roof, then cuts the feature.
- **False accessible:** the XZ slice looks clear, but a wall just beside that slice in Y collides with the cutter's circular radius or holder.

The slice analysis is exact only for geometry extruded uniformly along Y, or if the tool really is constrained to that plane.

For true 3D accessibility, use the same configuration-space idea in 3D:

```
blocked tool centers = solid ⊕ (-full 3D tool/holder)
reachable centers = flood-fill free space from the top of the stock
accessible surface = places the cutting portion of a reachable tool can touch
```

A practical implementation is a 3D voxel grid: inflate the solid by the tool silhouette, flood-fill air from +Z, then intersect reachable cutting contact with the mesh. You can still display the result as XZ contour slices—but derive them from this 3D result.

## Correction for Parallel Finishing

For a **parallel finishing pass** (raster lanes along X at fixed Y = yᵢ), the Y-detour case is irrelevant. Each XZ slice *is* the right analysis:

1. Constrain the tool center to that slice plane.
2. Build its 2D profile: ball-end = circle + shank; flat-end = width/height profile.
3. Flood-fill reachable tool-center space from +Z.
4. Mark curve segments the reachable cutting profile can touch; the rest are undercuts for that raster pass.
5. Repeat at each stepover `yᵢ`.

**Correction:** don't use a zero-thickness raw slice. The cutter extends in Y, so analyze a Y slab at least ± tool radius around each lane—or slice the 3D tool-clearance offset—so nearby geometry can still block that pass.

## Toolpath Calculation

For the target surface in each raster lane, treat it as a height function `h(x)`. Let `r` be tool radius. Generate cutter-location points along X:

**Flat-end tip height:**

```
z_tip(x) = max h(x + u)                    for |u| ≤ r
```

**Ball-end center height:**

```
z_center(x) = max [h(x + u) + √(r² - u²)]   for |u| ≤ r
```

Then emit `(x, y_lane, z)` points and join them with linear moves.

- **Flat-end:** the bottom disk must clear the highest surface anywhere under its radius. It stops high in the V and leaves a larger cusp.
- **Ball-end:** offset the contour by the ball radius; it reaches lower, but still leaves the sharp apex unless the ball radius tends toward zero.

For real parallel finishing, use the full 2D footprint—not only one XZ line:

```
flat: z(x,y) = max h(x+dx, y+dy)
ball: z(x,y) = max [h(x+dx, y+dy) + √(r²-dx²-dy²)]
              over dx² + dy² ≤ r²
```

Sample that cutter-location surface into raster lanes at the selected stepover, then resample each lane to chord tolerance.

This works for top-visible height-field surfaces. If a ray from +Z has multiple surface hits, it is an undercut/overhang case: mark it unavailable or use the configuration-space analysis and check flute/shank/holder collisions.

## Z Offset is NOT Constant

It is **not** a constant Z offset. At every X, offset by the highest target surface point touched by the tool footprint.

For a V with wall slope `m = tan(θ)`, at the apex:

```
flat tip lift = r · m
ball tip lift = r · (√(1 + m²) - 1) = r · (sec(θ) - 1)
```

So the ball reaches lower, but neither reaches a sharp V apex with finite radius. For a general contour, compute the formulas per sample—or equivalently offset by the tool profile and take the upper envelope—not `Z += constant`.

## What is `u`?

`u` is the horizontal offset from the tool center. At tool-center position `x`, it checks every point beneath the tool:

```
surface position = x + u
u ranges from -r to +r
```

So with a 2.5 mm radius tool at `x = 10`, it considers surface points from `7.5` to `12.5` mm.

## Efficient Computation

### Flat-end: Sliding-Window Maximum

Move a fixed-width window across a list and record the largest value inside it. For a flat cutter of radius `r`, the window spans `x-r` to `x+r`:

```
surface heights:  2  1  3  0  4
tool window:         [1  3  0]
maximum:                 3
```

The tool tip at that center position must be at least height `3`, otherwise its flat bottom would gouge the high point under its footprint. As the tool moves, slide the window one sample at a time and update the maximum efficiently — `O(n)` with a monotonic deque (or SciPy maximum filter).

### Ball-end

For each point `i`, check samples `j` within radius:

```
max(h[j] + sqrt(r² - (x[i] - x[j])²))
```

That simple version is `O(n·k)`, where `k ≈ 2r/dx`.

For an exact piecewise-linear contour, avoid samples entirely: construct the 2D offset envelope—parallel offsets of line segments plus radius arcs at vertices—then resample that resulting tool-center curve to chord tolerance for G1 moves.

## Flat-end vs Ball-end in a V Valley

With a V valley of slope `m` and tool radius `r`:

**Flat-end cutter:**
- Bottom corners touch both V walls simultaneously.
- The flat tip cannot descend farther — tip height at apex = `r · m`.

**Ball-end cutter:**
- Ball is tangent to both walls simultaneously.
- Reaches lower than flat-end, but still cannot reach a sharp apex.
- Center height at apex = `r · √(1 + m²)`, so tip height = `r · (√(1 + m²) - 1)`.