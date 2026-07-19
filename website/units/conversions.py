"""Server-side unit conversion inventory and math.

Factors and formulas match design/Unit-Conversions.md. URL slugs are stable
and must not change once published.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite, pi
from typing import Literal

CategoryKind = Literal["linear", "temperature", "fuel_economy"]
CategoryGroup = Literal["basic", "compound"]


@dataclass(frozen=True, slots=True)
class UnitDef:
    slug: str
    name: str
    symbol: str
    # Linear: multiply by factor to reach category base.
    # Fuel economy (distance/volume): multiply by factor to reach km/L.
    # Temperature / reciprocal fuel units: unused (0.0).
    factor: float = 0.0
    reciprocal: bool = False  # fuel: value is L/100km style (km/L = 100 / x)


@dataclass(frozen=True, slots=True)
class CategoryDef:
    slug: str
    label: str
    kind: CategoryKind
    units: tuple[UnitDef, ...]
    default_from: str
    default_to: str
    group: CategoryGroup = "basic"
    note: str | None = None

    def unit(self, slug: str) -> UnitDef | None:
        for unit in self.units:
            if unit.slug == slug:
                return unit
        return None


def _u(
    slug: str,
    name: str,
    symbol: str,
    factor: float = 0.0,
    *,
    reciprocal: bool = False,
) -> UnitDef:
    return UnitDef(slug=slug, name=name, symbol=symbol, factor=factor, reciprocal=reciprocal)


CATEGORIES: tuple[CategoryDef, ...] = (
    CategoryDef(
        slug="length",
        label="Length",
        kind="linear",
        group="basic",
        default_from="m",
        default_to="ft",
        units=(
            _u("km", "kilometre", "km", 1000.0),
            _u("m", "metre", "m", 1.0),
            _u("cm", "centimetre", "cm", 0.01),
            _u("mm", "millimetre", "mm", 0.001),
            _u("um", "micrometre", "µm", 1e-6),
            _u("nm", "nanometre", "nm", 1e-9),
            _u("mi", "mile (international)", "mi", 1609.344),
            _u("yd", "yard", "yd", 0.9144),
            _u("ft", "foot", "ft", 0.3048),
            _u("in", "inch", "in", 0.0254),
            _u("nmi", "nautical mile", "nmi", 1852.0),
            _u("ly", "light-year", "ly", 9.4607304725808e15),
            _u("au", "astronomical unit", "au", 149597870700.0),
        ),
    ),
    CategoryDef(
        slug="area",
        label="Area",
        kind="linear",
        group="basic",
        default_from="m2",
        default_to="ft2",
        units=(
            _u("km2", "square kilometre", "km²", 1e6),
            _u("ha", "hectare", "ha", 10000.0),
            _u("m2", "square metre", "m²", 1.0),
            _u("cm2", "square centimetre", "cm²", 1e-4),
            _u("mm2", "square millimetre", "mm²", 1e-6),
            _u("mi2", "square mile", "mi²", 2589988.110336),
            _u("ac", "acre", "ac", 4046.8564224),
            _u("yd2", "square yard", "yd²", 0.83612736),
            _u("ft2", "square foot", "ft²", 0.09290304),
            _u("in2", "square inch", "in²", 0.00064516),
        ),
    ),
    CategoryDef(
        slug="volume",
        label="Volume",
        kind="linear",
        group="basic",
        default_from="l",
        default_to="gal-uk",
        units=(
            _u("m3", "cubic metre", "m³", 1.0),
            _u("l", "litre", "L", 0.001),
            _u("ml", "millilitre", "mL", 1e-6),
            _u("cm3", "cubic centimetre", "cm³", 1e-6),
            _u("km3", "cubic kilometre", "km³", 1e9),
            _u("in3", "cubic inch", "in³", 1.6387064e-5),
            _u("ft3", "cubic foot", "ft³", 0.028316846592),
            _u("yd3", "cubic yard", "yd³", 0.764554857984),
            _u("gal-uk", "UK gallon", "gal (UK)", 0.00454609),
            _u("gal-us", "US gallon", "gal (US)", 0.003785411784),
            _u("pt-uk", "UK pint", "pt (UK)", 0.0005682615),
            _u("pt-us", "US liquid pint", "pt (US)", 0.000473176473),
            _u("floz-us", "US fluid ounce", "fl oz (US)", 2.95735295625e-5),
            _u("floz-uk", "UK fluid ounce", "fl oz (UK)", 2.84130625e-5),
            _u("tbsp", "tablespoon (US)", "tbsp", 1.478676478125e-5),
            _u("tsp", "teaspoon (US)", "tsp", 4.92892159375e-6),
        ),
    ),
    CategoryDef(
        slug="mass",
        label="Mass",
        kind="linear",
        group="basic",
        default_from="kg",
        default_to="lb",
        units=(
            _u("t", "tonne (metric)", "t", 1000.0),
            _u("kg", "kilogram", "kg", 1.0),
            _u("g", "gram", "g", 0.001),
            _u("mg", "milligram", "mg", 1e-6),
            _u("ug", "microgram", "µg", 1e-9),
            _u("lb", "pound", "lb", 0.45359237),
            _u("oz", "ounce", "oz", 0.028349523125),
            _u("st", "stone", "st", 6.35029318),
            _u("ton-us", "short ton (US)", "ton (US)", 907.18474),
            _u("ton-uk", "long ton (UK)", "ton (UK)", 1016.0469088),
            _u("gr", "grain", "gr", 6.479891e-5),
        ),
    ),
    CategoryDef(
        slug="time",
        label="Time",
        kind="linear",
        group="basic",
        default_from="h",
        default_to="min",
        note="Year uses a fixed Julian year (365.25 days). Calendar months are not included.",
        units=(
            _u("yr", "year (Julian)", "yr", 31557600.0),
            _u("wk", "week", "wk", 604800.0),
            _u("d", "day", "d", 86400.0),
            _u("h", "hour", "h", 3600.0),
            _u("min", "minute", "min", 60.0),
            _u("s", "second", "s", 1.0),
            _u("ms", "millisecond", "ms", 0.001),
            _u("us", "microsecond", "µs", 1e-6),
            _u("ns", "nanosecond", "ns", 1e-9),
        ),
    ),
    CategoryDef(
        slug="temperature",
        label="Temperature",
        kind="temperature",
        group="basic",
        default_from="c",
        default_to="f",
        units=(
            _u("k", "kelvin", "K"),
            _u("c", "Celsius", "°C"),
            _u("f", "Fahrenheit", "°F"),
            _u("r", "Rankine", "°R"),
        ),
    ),
    CategoryDef(
        slug="speed",
        label="Speed",
        kind="linear",
        group="compound",
        default_from="mph",
        default_to="km-h",
        note="Mach uses a fixed approximation of 340.3 m/s (15 °C at sea level).",
        units=(
            _u("m-s", "metre per second", "m/s", 1.0),
            _u("km-h", "kilometre per hour", "km/h", 1.0 / 3.6),
            _u("mph", "mile per hour", "mph", 0.44704),
            _u("ft-s", "foot per second", "ft/s", 0.3048),
            _u("kn", "knot", "kn", 1852.0 / 3600.0),
            _u("km-s", "kilometre per second", "km/s", 1000.0),
            _u("c", "speed of light", "c", 299792458.0),
            _u("ma", "mach (approx.)", "Ma", 340.3),
        ),
    ),
    CategoryDef(
        slug="acceleration",
        label="Acceleration",
        kind="linear",
        group="compound",
        default_from="m-s2",
        default_to="g0",
        units=(
            _u("m-s2", "metre per second squared", "m/s²", 1.0),
            _u("km-h-s", "kilometre per hour per second", "km/h/s", 1.0 / 3.6),
            _u("ft-s2", "foot per second squared", "ft/s²", 0.3048),
            _u("g0", "standard gravity", "g₀", 9.80665),
            _u("gal", "gal (cgs)", "Gal", 0.01),
        ),
    ),
    CategoryDef(
        slug="force",
        label="Force",
        kind="linear",
        group="compound",
        default_from="n",
        default_to="lbf",
        units=(
            _u("n", "newton", "N", 1.0),
            _u("kn", "kilonewton", "kN", 1000.0),
            _u("dyn", "dyne", "dyn", 1e-5),
            _u("kgf", "kilogram-force", "kgf", 9.80665),
            _u("lbf", "pound-force", "lbf", 4.4482216152605),
            _u("pdl", "poundal", "pdl", 0.138254954376),
        ),
    ),
    CategoryDef(
        slug="pressure",
        label="Pressure",
        kind="linear",
        group="compound",
        default_from="psi",
        default_to="bar",
        units=(
            _u("pa", "pascal", "Pa", 1.0),
            _u("kpa", "kilopascal", "kPa", 1000.0),
            _u("mpa", "megapascal", "MPa", 1e6),
            _u("bar", "bar", "bar", 1e5),
            _u("mbar", "millibar / hPa", "mbar", 100.0),
            _u("atm", "atmosphere (standard)", "atm", 101325.0),
            _u("torr", "torr", "Torr", 101325.0 / 760.0),
            _u("mmhg", "mmHg (conventional)", "mmHg", 133.322387415),
            _u("psi", "psi", "psi", 6894.757293168),
            _u("inhg", "inches of mercury", "inHg", 3386.389),
        ),
    ),
    CategoryDef(
        slug="energy",
        label="Energy",
        kind="linear",
        group="compound",
        default_from="kwh",
        default_to="j",
        units=(
            _u("j", "joule", "J", 1.0),
            _u("kj", "kilojoule", "kJ", 1000.0),
            _u("mj", "megajoule", "MJ", 1e6),
            _u("cal", "calorie (thermochemical)", "cal", 4.184),
            _u("kcal", "kilocalorie", "kcal", 4184.0),
            _u("wh", "watt-hour", "Wh", 3600.0),
            _u("kwh", "kilowatt-hour", "kWh", 3.6e6),
            _u("ev", "electronvolt", "eV", 1.602176634e-19),
            _u("btu", "British thermal unit (IT)", "BTU", 1055.05585262),
            _u("ft-lbf", "foot-pound", "ft·lbf", 1.3558179483314),
        ),
    ),
    CategoryDef(
        slug="power",
        label="Power",
        kind="linear",
        group="compound",
        default_from="kw",
        default_to="hp",
        units=(
            _u("w", "watt", "W", 1.0),
            _u("kw", "kilowatt", "kW", 1000.0),
            _u("mw", "megawatt", "MW", 1e6),
            _u("ps", "horsepower (metric)", "PS", 735.49875),
            _u("hp", "horsepower (mechanical)", "hp", 745.69987158227),
            _u("btu-h", "BTU per hour", "BTU/h", 0.293071070172),
            _u("ft-lbf-s", "foot-pound per second", "ft·lbf/s", 1.3558179483314),
        ),
    ),
    CategoryDef(
        slug="angle",
        label="Angle",
        kind="linear",
        group="basic",
        default_from="deg",
        default_to="rad",
        units=(
            _u("rad", "radian", "rad", 1.0),
            _u("deg", "degree", "°", pi / 180.0),
            _u("arcmin", "arcminute", "′", pi / 10800.0),
            _u("arcsec", "arcsecond", "″", pi / 648000.0),
            _u("gon", "gradian / gon", "gon", pi / 200.0),
            _u("rev", "turn / revolution", "rev", 2.0 * pi),
        ),
    ),
    CategoryDef(
        slug="frequency",
        label="Frequency",
        kind="linear",
        group="compound",
        default_from="rpm",
        default_to="hz",
        note="rad/s ↔ Hz treats frequency as cycles per second (f = ω / 2π).",
        units=(
            _u("hz", "hertz", "Hz", 1.0),
            _u("khz", "kilohertz", "kHz", 1000.0),
            _u("mhz", "megahertz", "MHz", 1e6),
            _u("ghz", "gigahertz", "GHz", 1e9),
            _u("rpm", "rpm", "rpm", 1.0 / 60.0),
            _u("rad-s", "radian per second", "rad/s", 1.0 / (2.0 * pi)),
        ),
    ),
    CategoryDef(
        slug="data",
        label="Data",
        kind="linear",
        group="basic",
        default_from="gb",
        default_to="gib",
        note="kB/MB/GB use decimal SI (1000ⁿ). KiB/MiB/GiB use binary IEC (1024ⁿ).",
        units=(
            _u("bit", "bit", "bit", 0.125),
            _u("b", "byte", "B", 1.0),
            _u("kb", "kilobyte (decimal)", "kB", 1000.0),
            _u("mb", "megabyte", "MB", 1e6),
            _u("gb", "gigabyte", "GB", 1e9),
            _u("tb", "terabyte", "TB", 1e12),
            _u("pb", "petabyte", "PB", 1e15),
            _u("kib", "kibibyte", "KiB", 1024.0),
            _u("mib", "mebibyte", "MiB", 1048576.0),
            _u("gib", "gibibyte", "GiB", 1073741824.0),
            _u("tib", "tebibyte", "TiB", 1099511627776.0),
            _u("pib", "pebibyte", "PiB", 1125899906842624.0),
        ),
    ),
    CategoryDef(
        slug="fuel-economy",
        label="Fuel economy",
        kind="fuel_economy",
        group="compound",
        default_from="mpg-uk",
        default_to="l-100km",
        note="mpg (UK) uses the imperial gallon; mpg (US) uses the US gallon.",
        units=(
            _u("km-l", "kilometres per litre", "km/L", 1.0),
            _u("mpg-uk", "miles per UK gallon", "mpg (UK)", 1.609344 / 4.54609),
            _u("mpg-us", "miles per US gallon", "mpg (US)", 1.609344 / 3.785411784),
            _u("l-100km", "litres per 100 km", "L/100km", reciprocal=True),
            _u("mi-l", "miles per litre", "mi/L", 1.609344),
        ),
    ),
    CategoryDef(
        slug="density",
        label="Density",
        kind="linear",
        group="compound",
        default_from="kg-m3",
        default_to="g-cm3",
        units=(
            _u("kg-m3", "kilogram per cubic metre", "kg/m³", 1.0),
            _u("g-cm3", "gram per cubic centimetre", "g/cm³", 1000.0),
            _u("g-ml", "gram per millilitre", "g/mL", 1000.0),
            _u("kg-l", "kilogram per litre", "kg/L", 1000.0),
            _u("lb-ft3", "pound per cubic foot", "lb/ft³", 16.01846337396),
            _u("lb-in3", "pound per cubic inch", "lb/in³", 27679.90471019),
            _u("lb-gal-us", "pound per US gallon", "lb/gal (US)", 119.826427317),
            _u("oz-in3", "ounce per cubic inch", "oz/in³", 1729.994044387),
        ),
    ),
    CategoryDef(
        slug="torque",
        label="Torque",
        kind="linear",
        group="compound",
        default_from="nm",
        default_to="lbf-ft",
        units=(
            _u("nm", "newton-metre", "N·m", 1.0),
            _u("ncm", "newton-centimetre", "N·cm", 0.01),
            _u("kgf-m", "kilogram-force metre", "kgf·m", 9.80665),
            _u("lbf-ft", "pound-force foot", "lbf·ft", 1.3558179483314),
            _u("lbf-in", "pound-force inch", "lbf·in", 0.1129848290276),
            _u("ozf-in", "ounce-force inch", "ozf·in", 0.00706155183333),
        ),
    ),
    CategoryDef(
        slug="flow",
        label="Flow",
        kind="linear",
        group="compound",
        default_from="l-min",
        default_to="gpm-uk",
        units=(
            _u("m3-s", "cubic metre per second", "m³/s", 1.0),
            _u("l-s", "litre per second", "L/s", 0.001),
            _u("l-min", "litre per minute", "L/min", 1.6666666666667e-5),
            _u("l-h", "litre per hour", "L/h", 2.7777777777778e-7),
            _u("ft3-s", "cubic foot per second", "ft³/s", 0.028316846592),
            _u("cfm", "cubic foot per minute", "CFM", 4.719474432e-4),
            _u("gpm-us", "US gallon per minute", "GPM (US)", 6.30901964e-5),
            _u("gpm-uk", "UK gallon per minute", "GPM (UK)", 7.5768166667e-5),
        ),
    ),
)

CATEGORY_BY_SLUG: dict[str, CategoryDef] = {category.slug: category for category in CATEGORIES}
DEFAULT_CATEGORY_SLUG = "length"


def get_category(slug: str) -> CategoryDef | None:
    return CATEGORY_BY_SLUG.get(slug)


def parse_value(raw: str) -> float | None:
    text = raw.strip().replace(",", "")
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    if not isfinite(value):
        return None
    return value


def canonical_value_string(value: float) -> str:
    """Stable URL-safe representation of a finite float."""
    if value == 0:
        return "0"
    if abs(value) >= 1e15 or (abs(value) < 1e-4 and value != 0):
        return f"{value:.12g}".replace("+", "")
    as_int = int(value)
    if as_int == value and abs(as_int) < 10**15:
        return str(as_int)
    return f"{value:.12g}".replace("+", "")


def format_number(value: float | None) -> str:
    if value is None or not isfinite(value):
        return "—"
    if value == 0:
        return "0"
    abs_value = abs(value)
    if abs_value >= 1e6 or abs_value < 1e-4:
        return f"{value:.6g}".replace("+", "")
    text = f"{value:.10g}".replace("+", "")
    if "e" in text.lower():
        return text
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def result_path(category: str, value: float, from_slug: str, to_slug: str) -> str:
    return (
        f"/units/{category}/{canonical_value_string(value)}/"
        f"{from_slug}/to/{to_slug}/"
    )


def _to_kelvin(slug: str, value: float) -> float:
    if slug == "k":
        return value
    if slug == "c":
        return value + 273.15
    if slug == "f":
        return (value + 459.67) * (5.0 / 9.0)
    if slug == "r":
        return value * (5.0 / 9.0)
    raise KeyError(slug)


def _from_kelvin(slug: str, kelvin: float) -> float:
    if slug == "k":
        return kelvin
    if slug == "c":
        return kelvin - 273.15
    if slug == "f":
        return kelvin * (9.0 / 5.0) - 459.67
    if slug == "r":
        return kelvin * (9.0 / 5.0)
    raise KeyError(slug)


def _to_km_per_litre(unit: UnitDef, value: float) -> float | None:
    if value <= 0:
        return None
    if unit.reciprocal:
        return 100.0 / value
    return value * unit.factor


def _from_km_per_litre(unit: UnitDef, km_per_litre: float) -> float | None:
    if km_per_litre <= 0:
        return None
    if unit.reciprocal:
        return 100.0 / km_per_litre
    return km_per_litre / unit.factor


def convert(
    category: CategoryDef,
    value: float,
    from_slug: str,
    to_slug: str,
) -> float | None:
    from_unit = category.unit(from_slug)
    to_unit = category.unit(to_slug)
    if from_unit is None or to_unit is None:
        raise KeyError(f"Unknown unit for {category.slug}: {from_slug!r} / {to_slug!r}")

    if category.kind == "temperature":
        return _from_kelvin(to_slug, _to_kelvin(from_slug, value))

    if category.kind == "fuel_economy":
        base = _to_km_per_litre(from_unit, value)
        if base is None:
            return None
        return _from_km_per_litre(to_unit, base)

    base = value * from_unit.factor
    return base / to_unit.factor


@dataclass(frozen=True, slots=True)
class ConversionRow:
    unit: UnitDef
    value: float | None
    display: str
    share_path: str
    is_primary: bool
    is_source: bool


def convert_all(
    category: CategoryDef,
    value: float,
    from_slug: str,
    to_slug: str,
) -> tuple[ConversionRow, ...]:
    rows: list[ConversionRow] = []
    for unit in category.units:
        converted = convert(category, value, from_slug, unit.slug)
        rows.append(
            ConversionRow(
                unit=unit,
                value=converted,
                display=format_number(converted),
                share_path=result_path(category.slug, value, from_slug, unit.slug),
                is_primary=unit.slug == to_slug,
                is_source=unit.slug == from_slug,
            )
        )
    return tuple(rows)
