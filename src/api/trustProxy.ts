/**
 * Turns the TRUST_PROXY environment value into Express's 'trust proxy' setting.
 *
 * - unset or empty: false (Express default, req.ip is the direct peer)
 * - a whole number such as "1": trust that many proxy hops
 * - "true" / "false": trust every hop / none (true lets clients spoof req.ip)
 * - anything else, such as "loopback, 10.0.0.0/8": passed through as an address list
 */
export function resolveTrustProxy(raw: string | undefined): boolean | number | string {
  const value = raw?.trim();
  if (!value) return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
