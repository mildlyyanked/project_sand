import { compass, formatDistance } from './style';
import type { MapDoc, MapPin } from './types';

/**
 * What the maps say about where things are, in words a character could use:
 * how far, which way, how long on foot. Globes measure along the sphere;
 * everything else measures straight across the map.
 */

/** Latitude and longitude (radians) of a point on a Mercator globe map. */
export function latLon(doc: Pick<MapDoc, 'w' | 'h'>, x: number, y: number): { lat: number; lon: number } {
  const k = doc.w / (2 * Math.PI);
  return { lon: (x - doc.w / 2) / k, lat: 2 * Math.atan(Math.exp((doc.h / 2 - y) / k)) - Math.PI / 2 };
}
/** The map y of a latitude (radians) on a Mercator globe map. */
export function mercY(doc: Pick<MapDoc, 'w' | 'h'>, lat: number): number {
  const k = doc.w / (2 * Math.PI);
  return doc.h / 2 - k * Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

/** Distance between two points of a map, in metres. */
export function metresBetween(doc: Pick<MapDoc, 'kind' | 'w' | 'h' | 'scale'>, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const metresPer = doc.scale.per * (doc.scale.unit === 'km' ? 1000 : 1);
  if (doc.kind !== 'globe') return Math.hypot(a.x - b.x, a.y - b.y) * metresPer;
  const p = latLon(doc, a.x, a.y);
  const q = latLon(doc, b.x, b.y);
  const radius = (doc.w * metresPer) / (2 * Math.PI);
  const h = Math.sin((q.lat - p.lat) / 2) ** 2 + Math.cos(p.lat) * Math.cos(q.lat) * Math.sin((q.lon - p.lon) / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const distanceWords = (metres: number) => formatDistance(metres, { unit: 'm', per: 1 });

/** How long a distance takes on foot, as a person would say it. Nothing for a few steps or for a journey across a world. */
export function onFoot(metres: number): string {
  if (metres < 150) return '';
  const minutes = metres / 80; // about 5 km an hour
  if (minutes < 50) return `${Math.max(2, Math.round(minutes / 5) * 5)} minutes on foot`;
  if (minutes < 60 * 9) { const h = Math.round(minutes / 30) / 2; return `${h === 1 ? 'an hour' : `${h} hours`} on foot`; }
  const days = Math.round(metres / 30000); // 30 km a day on the road
  if (days > 120) return '';
  return `${days <= 1 ? 'a day' : `${days} days`} on foot`;
}

/** One pin as seen from another: "2.4 km north-east (30 minutes on foot)". */
export function bearing(doc: MapDoc, from: MapPin, to: MapPin): string {
  const m = metresBetween(doc, from, to);
  const walk = onFoot(m);
  return `${distanceWords(m)} ${compass(from, to)}${walk ? ` (${walk})` : ''}`;
}

/**
 * The lines the writer gets about where the scene is: on the map of each
 * place it sits within, how far and which way the nearest other places
 * are. `chain` is the scene's place and then its parents, innermost first;
 * `mapOf` finds a place's map.
 */
export function whereLines(chain: { id: string; name: string }[], mapOf: (locationId: string) => MapDoc | null | undefined, o: { levels?: number; per?: number } = {}): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < chain.length && out.length < (o.levels ?? 2); i++) {
    const here = chain[i]!;
    const doc = mapOf(chain[i + 1]!.id);
    if (!doc) continue;
    const pin = doc.pins.find((p) => p.entityId === here.id);
    if (!pin) continue;
    const others = doc.pins.filter((p) => p.id !== pin.id).map((p) => ({ p, m: metresBetween(doc, pin, p) })).sort((a, b) => a.m - b.m).slice(0, o.per ?? 6);
    if (!others.length) continue;
    out.push(`From ${here.name}, on the map of ${chain[i + 1]!.name}: ${others.map(({ p }) => `${p.name} is ${bearing(doc, pin, p)}`).join('; ')}.`);
  }
  return out;
}
