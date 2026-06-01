// Health Auto Export emits "yyyy-MM-dd HH:mm:ss Z" where Z is "+0000" style.
// Convert to a strict ISO 8601 string ("...T...+00:00") before constructing Date,
// because Date parsing of the space/compact-offset form is engine-dependent.
const HAE_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{2})(\d{2})$/;

export function parseHaeDate(input: string): Date {
  const m = HAE_DATE_RE.exec(input.trim());
  if (!m) throw new Error(`Unparseable HAE date: ${input}`);
  const [, y, mo, d, h, mi, s, offH, offM] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${offH}:${offM}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid HAE date: ${input}`);
  return date;
}
