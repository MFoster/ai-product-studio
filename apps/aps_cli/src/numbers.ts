export function parseDecimal(value: string): number | undefined {
  const text = value.trim();
  if (
    !/^[+-]?(?:(?:\d(?:_?\d)*)?(?:\.(?:\d(?:_?\d)*)?)|(?:\d(?:_?\d)*))(?:e[+-]?\d(?:_?\d)*)?$/i.test(
      text,
    ) ||
    !/\d/.test(text)
  )
    return undefined;
  return Number(text.replaceAll("_", ""));
}

export function formatGeneral(value: number, precision = 6): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value < 0 ? "-inf" : "inf";
  if (value === 0) return Object.is(value, -0) ? "-0" : "0";
  const rounded = Number(value.toPrecision(precision));
  const exponent = Math.floor(Math.log10(Math.abs(rounded)));
  if (exponent < -4 || exponent >= precision) {
    const [digits, power] = rounded.toExponential().split("e");
    const exp = Number(power);
    return `${digits}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return String(rounded);
}
