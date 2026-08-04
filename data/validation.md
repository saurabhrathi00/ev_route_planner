# Measured consumption, and what it says about the model

The physics in `web/index.html` was never checked against a real car. This
records the first attempt, what it found, and — more importantly — why what it
found is not yet enough to change a constant on.

## Where the numbers came from

[Autocar India, *Real world EV range tested of top EV cars in India*](https://www.autocarindia.com/auto-features/real-world-ev-range-tested-of-top-ev-cars-in-india-434105),
cross-checked against their individual tests for the
[Curvv EV](https://www.autocarindia.com/auto-features/tata-curvv-ev-real-world-range-tested-explained-434081)
and [Windsor EV](https://www.autocarindia.com/auto-features/mg-windsor-ev-real-world-range-tested-explained-434052).

One publication, one method, fifteen cars. That consistency is worth more here
than mixing sources would be: we are comparing cars against each other, and a
shared method cancels out of that comparison. It is also the whole weakness —
see the limits below.

Autocar quote km/kWh against the **gross** pack (365 km ÷ 6.64 = 55.0 kWh for a
Curvv, which is its gross figure, not the 52 usable). The table below converts
using our own usable capacities instead, so the comparison is self-consistent
with what the app simulates.

| Car | Usable kWh | Measured range | Measured Wh/km | Model | Model ÷ measured |
|---|---|---|---|---|---|
| MG Comet EV | 17.3 | 193 | 90 | 97 | 1.08 |
| Hyundai Creta Electric | 51.4 | 432 | 119 | 129 | 1.08 |
| Tata Nexon EV 45 | 40.5 | 350 | 116 | 123 | 1.06 |
| Tata Tiago EV | 22 | 187 | 118 | 113 | 0.96 |
| MG Windsor EV | 37.9 | 308 | 123 | 124 | 1.01 |
| Citroen eC3 | 27.5 | 228 | 121 | 117 | 0.97 |
| Kia Carens Clavis EV | 49 | 364 | 135 | 130 | 0.97 |
| MG ZS EV | 48 | 339 | 142 | 127 | 0.89 |
| Tata Tigor EV | 24 | 190 | 126 | 111 | 0.88 |
| Tata Curvv EV 55 | 52 | 365 | 142 | 122 | 0.86 |
| Tata Harrier EV | 71 | 401 | 177 | 149 | 0.84 |
| Mahindra XEV 9e | 75 | 456 | 164 | 134 | 0.81 |
| Mahindra BE 6 | 75 | 449 | 167 | 129 | 0.77 |
| VinFast VF7 | 68 | 391 | 174 | 133 | 0.77 |

## What it supports

**The model is systematically light, by roughly 9%.** Ten of fourteen cars
consume more than it predicts; the median road-load correction is 1.09. Fourteen
independent cars agreeing on a direction is a real signal, not noise.

**The error is worse for heavy cars.** Everything at 0.85 or below is a two-tonne
SUV; everything at 1.0 or above is small and light. Something scales with mass
that the model under-counts — most likely rolling resistance, which is assumed
at crr 0.0095 for every car when a big SUV on soft tyres is nearer 0.012.

**The shared fit is not the problem.** The errors run in both directions, which
they would not if `eta` or `C` were wrong. Whatever is missing is per-car.

## What it does not support

**Any per-car constant.** Each factor comes from exactly one test, on one day,
at an ambient temperature nobody published. The model itself says 0 °C and 25 °C
differ by 1.55x on a slow drive — so a single undated figure cannot separate
"this car is thirsty" from "that test was in June".

**Nor the 9%, quite.** The comparison needs a model of Autocar's own test — it
assumes a 32 km/h city loop, an 85 km/h highway loop, 60% air-conditioning at
28 °C. Move the assumed highway speed to 95 and much of the 9% closes. The
signal's direction is solid; its size is not.

**Nothing about model years.** A 2025 Tiago and a 2026 Tiago are different cars
and these figures do not say which was tested.

So: no constant in `web/index.html` has been changed on the strength of this.
It is here as a reference to test future changes against, and as the reason for
what follows.

## Second test: does the correction hold at a different speed?

`tools/verify-real.js`. The corrections above were fitted to Autocar's
**combined** figures. This runs the shipped engine against their **highway**
ones — same cars, same method, a different part of the data and a different
speed regime. A single scalar cannot tell rolling resistance from drag, so the
question is whether one fitted at a mixed speed still holds at a steady cruise,
or whether it only ever fitted the average.

Measured highway range: Curvv EV 55 359 km, Nexon EV 45 345 km, Windsor 289 km.

**With the correction, by assumed test speed:**

| Speed assumed | Curvv | Nexon | Windsor |
|---|---|---|---|
| 65 km/h | +5% | +6% | +10% |
| **70 km/h** | **−1%** | **−0%** | **+4%** |
| 75 km/h | −7% | −6% | −2% |
| 85 km/h | −17% | −17% | −14% |

**Without it, at 85 km/h:** −3%, −23%, −15%.

Two things fall out.

**The correction does what it was for.** Uncorrected, the three cars are
scattered across twenty points — one nearly right, one badly wrong. Corrected,
they move together: at any assumed speed they sit within about five points of
each other. It generalised out of the regime it was fitted in, which was the
thing most likely to have gone wrong.

**The absolute level is not settled, and cannot be from here.** It rests
entirely on a number nobody published: the speed Autocar actually held. At
70 km/h the model is within 1%; at 85 it is 17% pessimistic. A highway loop
averaging 70-75 km/h through Indian traffic is entirely plausible, and so is
85 — the data cannot say which.

So: the shape of the model is right and the per-car corrections are doing
their job. Where the whole thing sits is an open question that one drive with
a known average speed would close, and that no amount of further reading will.

## Third test: an independent source, at a speed it states

The two tests above share a publication and a method, and both leave the same
hole — nobody published the speed. [InsideEVs run a constant 70 mph highway
loop](https://insideevs.com/reviews/443791/ev-range-test-results/), GPS-verified,
from 100%, repeated and averaged. Different country, different testers, a speed
that is stated rather than assumed, and four cars that overlap with `CARS`.

None of those four has ever been fitted to anything: they sit at the 1.09
median, so this is out of sample twice over.

| Car | Measured @112.7 km/h | Model | Error |
|---|---|---|---|
| Kia EV6 GT-Line AWD | 394 km | 315 km | −20.1% |
| Tesla Model 3 AWD | 499 km | 401 km | −19.6% |
| Tesla Model Y AWD | 444 km | 360 km | −19.0% |
| Hyundai Ioniq 5 AWD | 365 km | 309 km | −15.4% |

Without the 1.09 applied: −13%, −13%, −12%, −8%.

The model wants more energy than these cars use, consistently, and by about the
same amount each time. Four cars clustered inside five points is a bias, not
noise — and it points the same way as the Autocar highway figures did at 85 km/h.

**Solving each car for the drivetrain efficiency that would match it:**

| Car | Implied eta |
|---|---|
| Kia EV6 AWD | 89.1% |
| Tesla Model 3 AWD | 88.8% |
| Tesla Model Y AWD | 87.8% |
| Hyundai Ioniq 5 AWD | 84.1% |

The anchor fit produces **77.4%**. A real EV drivetrain, battery to wheels,
runs 85-90%. Four independent cars land in that band; the anchor does not.

And the anchor is the one input in this whole model known to be invented — its
two reference drives were taken off the internet rather than measured, which is
what prompted this file in the first place.

`eta` scales rolling, aero and climb alike, so it is the single most
consequential number in the app. If it is 77.4% where it should be near 88%,
everything the app predicts is about 12% too expensive — which is the size of
the gap both independent sources report.

Nothing has been changed on this yet, deliberately. Moving `eta` invalidates
every per-car correction above, since those were fitted with 0.774 assumed;
the two have to be re-derived together. Doing that as the last commit of a long
day, on a model whose previous change is still unverified, is how the 0.05
regen figure survived four years.

The drive settles both at once. If a real trip costs about 12% less than the
app predicts, this is confirmed and both numbers get re-derived from data that
was measured rather than found.

## What would actually settle it

Not more scraping. What is missing is many observations per car, spread across
seasons, with the conditions recorded — and that dataset does not exist publicly
for Indian EVs at all.

It does exist, unwritten, in the app's own trip log. Every entry is a real
drive: this car, this route, this weather, this driver, predicted against actual.
It never leaves the device, so nobody learns from it but its owner.

The proxy in `backlog.md` is what changes that. Alongside the charger cache, an
endpoint that accepts an anonymous record — car, model year, distance, climb,
mean temperature, predicted percent, actual percent — would build exactly the
dataset this file is missing, from real drives rather than one afternoon's
review, and it would keep building as model years change.

That is a stronger reason to build the proxy than the quota was.

## Reproducing this

```
usable_kWh × 1000 ÷ measured_range_km          → measured Wh/km
```
The model column is the road-load and climate terms at Autocar's assumed test
profile, using each car's `kerb` and `cdA` from `CARS`, `eta` 0.774 and `C` 0.990
from the anchor fit. Both are in this file's history rather than in code,
deliberately: they are a measurement of the model, not a part of it.
