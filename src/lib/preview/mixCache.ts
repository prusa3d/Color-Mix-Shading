import { mixFilaments, type FilamentPart, type MixResult } from '../prusa-fdm-mixer/prusa-fdm-mixer';

const cache = new Map<string, MixResult>();

export function mixFilamentsCached(parts: FilamentPart[]): MixResult {
  const key = parts
    .map((p) => `${p.hex.toLowerCase()}:${p.ratio.toFixed(4)}`)
    .sort()
    .join('|');
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const result = mixFilaments(parts);
  cache.set(key, result);
  return result;
}
