"""LANDPARAM rappture2web demo — land use change parameters for sub-Saharan Africa."""
import sys
import math
import random
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

market_access_pct = float(rx['input.(market_access_pct).current'].value or 10)
region_filter     = rx['input.(region_filter).current'].value or 'all'
cover_type        = rx['input.(cover_type).current'].value or 'all'

# ── Spatial logit model parameters (from Liu & Villoria 2015) ─────────────────
# β_market = coefficient on market access index in logit model
BETA_MARKET = 0.032   # logit coefficient for market access

# ── SSA country/region catalogue ──────────────────────────────────────────────
# (ISO3, name, region, centroid_lat, centroid_lon, baseline_uncult_frac)
COUNTRIES = [
    # East Africa
    ("ETH", "Ethiopia",           "E",  9.0,  40.5,  0.52),
    ("KEN", "Kenya",              "E", -1.0,  37.9,  0.44),
    ("TZA", "Tanzania",           "E", -6.4,  35.0,  0.58),
    ("UGA", "Uganda",             "E",  1.3,  32.3,  0.39),
    ("MOZ", "Mozambique",         "E", -17.5, 35.0,  0.62),
    ("MDG", "Madagascar",         "E", -20.0, 47.0,  0.55),
    ("ZMB", "Zambia",             "E", -13.0, 27.5,  0.60),
    ("MWI", "Malawi",             "E", -13.2, 34.3,  0.36),
    ("RWA", "Rwanda",             "E", -1.9,  29.9,  0.28),
    ("BDI", "Burundi",            "E", -3.4,  29.9,  0.30),
    # South Africa
    ("ZAF", "South Africa",       "S", -29.0, 25.0,  0.40),
    ("ZWE", "Zimbabwe",           "S", -19.0, 29.8,  0.45),
    ("BWA", "Botswana",           "S", -22.0, 24.7,  0.70),
    ("NAM", "Namibia",            "S", -22.0, 17.0,  0.75),
    ("AGO", "Angola",             "S", -11.2, 17.9,  0.65),
    ("SWZ", "Eswatini",           "S", -26.5, 31.5,  0.32),
    ("LSO", "Lesotho",            "S", -29.6, 28.2,  0.35),
    # West Africa
    ("NGA", "Nigeria",            "W",  9.0,   8.7,  0.42),
    ("GHA", "Ghana",              "W",  7.9,  -1.0,  0.38),
    ("CIV", "Côte d'Ivoire",      "W",  7.5,  -5.5,  0.43),
    ("SEN", "Senegal",            "W", 14.5, -14.5,  0.55),
    ("MLI", "Mali",               "W", 17.6,  -3.0,  0.72),
    ("BFA", "Burkina Faso",       "W", 12.4,  -1.6,  0.48),
    ("NER", "Niger",              "W", 17.6,   8.1,  0.78),
    ("CMR", "Cameroon",           "W",  5.7,  12.7,  0.50),
    ("GIN", "Guinea",             "W", 10.8, -10.9,  0.46),
    ("BEN", "Benin",              "W",  9.3,   2.3,  0.44),
    ("TGO", "Togo",               "W",  8.6,   0.8,  0.41),
    ("SLE", "Sierra Leone",       "W",  8.5, -11.8,  0.40),
    # Central Africa
    ("COD", "DR Congo",           "C", -4.0,  22.0,  0.58),
    ("COG", "Republic of Congo",  "C", -1.0,  15.8,  0.62),
    ("GAB", "Gabon",              "C", -1.0,  11.8,  0.65),
    ("CAF", "Central Afr. Rep.",  "C",  7.0,  21.0,  0.60),
    ("TCD", "Chad",               "C", 15.0,  19.0,  0.70),
    ("GNQ", "Eq. Guinea",         "C",  1.6,  10.3,  0.55),
]

# Baseline land cover mix per country: (forest_frac, grassland_frac, shrubland_frac)
COVER_MIX = {
    "ETH": (0.12, 0.52, 0.36), "KEN": (0.08, 0.55, 0.37), "TZA": (0.37, 0.35, 0.28),
    "UGA": (0.42, 0.38, 0.20), "MOZ": (0.46, 0.30, 0.24), "MDG": (0.22, 0.45, 0.33),
    "ZMB": (0.49, 0.28, 0.23), "MWI": (0.34, 0.40, 0.26), "RWA": (0.18, 0.48, 0.34),
    "BDI": (0.15, 0.55, 0.30), "ZAF": (0.07, 0.65, 0.28), "ZWE": (0.43, 0.32, 0.25),
    "BWA": (0.02, 0.70, 0.28), "NAM": (0.04, 0.55, 0.41), "AGO": (0.46, 0.30, 0.24),
    "SWZ": (0.30, 0.50, 0.20), "LSO": (0.02, 0.85, 0.13), "NGA": (0.15, 0.48, 0.37),
    "GHA": (0.22, 0.42, 0.36), "CIV": (0.33, 0.38, 0.29), "SEN": (0.08, 0.48, 0.44),
    "MLI": (0.02, 0.38, 0.60), "BFA": (0.04, 0.50, 0.46), "NER": (0.01, 0.32, 0.67),
    "CMR": (0.40, 0.35, 0.25), "GIN": (0.26, 0.42, 0.32), "BEN": (0.12, 0.52, 0.36),
    "TGO": (0.15, 0.50, 0.35), "SLE": (0.38, 0.38, 0.24), "COD": (0.68, 0.20, 0.12),
    "COG": (0.62, 0.22, 0.16), "GAB": (0.80, 0.12, 0.08), "CAF": (0.58, 0.25, 0.17),
    "TCD": (0.10, 0.35, 0.55), "GNQ": (0.70, 0.18, 0.12),
}

# Uncultivated area per country (Mha)  - approximate
UNCULT_AREA = {
    "ETH": 32.4, "KEN": 25.1, "TZA": 55.2, "UGA": 12.8, "MOZ": 58.7, "MDG": 31.5,
    "ZMB": 46.8, "MWI":  6.3, "RWA":  1.6, "BDI":  1.9, "ZAF": 28.5, "ZWE": 20.3,
    "BWA": 27.1, "NAM": 44.2, "AGO": 54.8, "SWZ":  0.7, "LSO":  1.0, "NGA": 38.2,
    "GHA": 12.4, "CIV": 14.8, "SEN": 10.8, "MLI": 35.0, "BFA": 11.6, "NER": 36.4,
    "CMR": 25.0, "GIN":  8.7, "BEN":  5.2, "TGO":  3.1, "SLE":  4.0, "COD": 98.4,
    "COG": 24.2, "GAB": 21.8, "CAF": 40.3, "TCD": 48.6, "GNQ":  2.2,
}

# ── Spatial logit: compute updated cultivation probability ────────────────────
def logistic(x):
    return 1.0 / (1.0 + math.exp(-x))

def cult_prob_baseline(uncult_frac):
    """Convert uncultivated fraction to baseline cultivation probability."""
    cult_frac = 1.0 - uncult_frac
    # Add small noise per grid cell
    return min(0.95, max(0.02, cult_frac + random.gauss(0, 0.04)))

def cult_prob_updated(p0, market_shock_frac):
    """Apply market access shock via logit model."""
    if p0 <= 0 or p0 >= 1:
        return p0
    logit0 = math.log(p0 / (1 - p0))
    logit1 = logit0 + BETA_MARKET * market_shock_frac * 100
    return logistic(logit1)

# ── Generate dense grid points for SSA heatmap ────────────────────────────────
random.seed(42)
shock = market_access_pct / 100.0

COVER_LABELS = {"F": "Forest", "G": "Grassland", "S": "Shrubland"}

grid_points = []  # (lat, lon, iso, region, cover, p_base, p_new)
for iso, name, reg, clat, clon, uncult_frac in COUNTRIES:
    mix = COVER_MIX.get(iso, (0.33, 0.34, 0.33))
    # Dense grid: ~40-60 points per country for heatmap density
    n_pts = random.randint(40, 60)
    for _ in range(n_pts):
        dlat = random.gauss(0, 2.2)
        dlon = random.gauss(0, 2.8)
        lat  = clat + dlat
        lon  = clon + dlon
        # assign cover type by mix
        r = random.random()
        if r < mix[0]:
            cover = "F"
        elif r < mix[0] + mix[1]:
            cover = "G"
        else:
            cover = "S"
        p0 = cult_prob_baseline(uncult_frac)
        p1 = cult_prob_updated(p0, shock)
        grid_points.append((lat, lon, iso, reg, cover, p0, p1))

# ── 1) Map output — density heatmap of cultivation probability ────────────────
rx['output.mapviewer(map).about.label'] = 'Predicted Cultivation Probability'
rx['output.mapviewer(map).projection'] = 'natural earth'
rx['output.mapviewer(map).scope'] = 'africa'

rx['output.mapviewer(map).layer(prob).about.label'] = 'Cult. Probability'
rx['output.mapviewer(map).layer(prob).type'] = 'heatmap'
rx['output.mapviewer(map).layer(prob).colorscale'] = 'YlOrRd'
rx['output.mapviewer(map).layer(prob).size'] = '7'
rx['output.mapviewer(map).layer(prob).opacity'] = '0.80'

heat_lines = []
for lat, lon, iso, reg, cover, p0, p1 in grid_points:
    # Apply filters
    if region_filter != 'all' and reg != region_filter:
        continue
    if cover_type != 'all' and cover != cover_type:
        continue
    label = f"{iso} ({COVER_LABELS.get(cover, cover)})"
    heat_lines.append(f"{lat:.3f} {lon:.3f} {p1:.3f} {label}")
rx['output.mapviewer(map).layer(prob).data'] = '\n'.join(heat_lines)

# ── 2) Elasticity table ───────────────────────────────────────────────────────
# Own-price land supply elasticity ε_s and land transformation elasticity ε_t
# Derived analytically from spatial logit: ε_s = β * P(1-P) * (market_shock/ε_D)
# We use synthetic but plausible region-level values

REGION_LABELS = {"E": "East Africa", "W": "West Africa", "S": "Southern Africa", "C": "Central Africa"}
REGION_EPS_D  = {"E": -0.35, "W": -0.28, "S": -0.40, "C": -0.22}   # demand price elasticity
REGION_SHARE  = {"E": 0.28,  "W": 0.32,  "S": 0.22,  "C": 0.18}    # initial cultivated share

def compute_elasticities(reg, shock_frac):
    p = REGION_SHARE[reg]
    eps_d = REGION_EPS_D[reg]
    # Own-price supply: logit derivative scaled by shock
    eps_s = BETA_MARKET * p * (1 - p) * shock_frac * 100 / abs(eps_d)
    # Transformation: ratio of marginal supply across cover types (synthetic scalar)
    eps_t = -eps_s * 0.62 * random.gauss(1.0, 0.05)
    return round(eps_s, 3), round(eps_t, 3)

random.seed(99)
rx['output.table(elasticities).about.label'] = 'Elasticity Parameters by Region'
rx['output.table(elasticities).column(0).label'] = 'Sub-region'
rx['output.table(elasticities).column(1).label'] = 'Own-price Supply Elasticity'
rx['output.table(elasticities).column(2).label'] = 'Land Transformation Elasticity'

rows_e = []
for reg in ["E", "W", "S", "C"]:
    eps_s, eps_t = compute_elasticities(reg, shock)
    rows_e.append(f"{REGION_LABELS[reg]}, {eps_s}, {eps_t}")
rx['output.table(elasticities).data'] = '\n'.join(rows_e)

# ── 3) Cropland conversion table ──────────────────────────────────────────────
# Cropland converted from forest (F), grassland (G), shrubland (S) in Mha
# ΔArea_c = Σ_i [uncult_area_i * cover_frac_ic * (p1_i - p0_i)]

delta_by_cover = {"F": 0.0, "G": 0.0, "S": 0.0}
for iso, name, reg, clat, clon, uncult_frac in COUNTRIES:
    if region_filter != 'all' and reg != region_filter:
        continue
    mix = COVER_MIX.get(iso, (0.33, 0.34, 0.33))
    area = UNCULT_AREA.get(iso, 10.0)
    # mean delta prob for this country
    pts = [pt for pt in grid_points if pt[2] == iso]
    if not pts:
        continue
    mean_delta = sum(p1 - p0 for *_, p0, p1 in pts) / len(pts)
    delta_by_cover["F"] += area * mix[0] * mean_delta
    delta_by_cover["G"] += area * mix[1] * mean_delta
    delta_by_cover["S"] += area * mix[2] * mean_delta

rx['output.table(conversion).about.label'] = 'Cropland Conversion by Land Cover (Mha)'
rx['output.table(conversion).column(0).label'] = 'Land Cover Type'
rx['output.table(conversion).column(1).label'] = 'Area Converted (Mha)'
rx['output.table(conversion).column(2).label'] = 'Share of Total (%)'

total_conv = sum(delta_by_cover.values())
conv_rows = []
for code, cname in [("F","Forest"), ("G","Grassland"), ("S","Shrubland")]:
    val  = round(delta_by_cover[code], 2)
    pct  = round(100 * delta_by_cover[code] / total_conv, 1) if total_conv > 0 else 0.0
    conv_rows.append(f"{cname}, {val}, {pct}")
rx['output.table(conversion).data'] = '\n'.join(conv_rows)

# ── 4) Supply curve: new cropland area vs. market access shock ────────────────
# Evaluate the model at 1%, 5%, 10%, 15%, 20%, 30%, 40%, 50%
shock_levels = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
supply_area  = []
random.seed(77)

for s_pct in shock_levels:
    s_frac = s_pct / 100.0
    total_delta = 0.0
    for iso, name, reg, clat, clon, uncult_frac in COUNTRIES:
        if region_filter != 'all':
            if reg != region_filter:
                continue
        mix  = COVER_MIX.get(iso, (0.33, 0.34, 0.33))
        area = UNCULT_AREA.get(iso, 10.0)
        pts  = [pt for pt in grid_points if pt[2] == iso]
        if not pts:
            continue
        p0_mean = sum(pt[5] for pt in pts) / len(pts)
        p1_mean = cult_prob_updated(p0_mean, s_frac)
        total_delta += area * (p1_mean - p0_mean)
    supply_area.append(round(total_delta, 2))

rx['output.curve(supply).about.label'] = 'New Cropland Supply Schedule'
rx['output.curve(supply).xaxis.label'] = 'Market Access Increase'
rx['output.curve(supply).xaxis.units'] = '%'
rx['output.curve(supply).yaxis.label'] = 'New Cropland Area'
rx['output.curve(supply).yaxis.units'] = 'Mha'

xy_lines = '\n'.join(f"{x} {y}" for x, y in zip(shock_levels, supply_area))
rx['output.curve(supply).component.xy'] = xy_lines

rx.close()
