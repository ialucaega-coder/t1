/**
 * Guarda anti-SSRF para URLs salientes provistas por el usuario (webhooks).
 *
 * Rechaza esquemas no http(s) y destinos que resuelvan a rangos privados,
 * loopback, link-local (incluida la metadata de la nube 169.254.169.254),
 * CGNAT y ULA IPv6. Para nombres DNS resuelve y valida TODAS las direcciones.
 *
 * Nota: queda una ventana teórica de DNS-rebinding (resolvemos y luego fetch
 * puede re-resolver distinto). Es una mitigación best-effort razonable sin un
 * proxy de egreso dedicado; para defensa total haría falta filtrar el egreso.
 */
import dns from 'dns';
import net from 'net';
import { AppError } from '../middleware/errorHandler';

/** ¿La IP (v4 o v6) cae en un rango no ruteable/privado que no debemos tocar? */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0) return true; // "this" network
    if (p[0] === 10) return true; // privada
    if (p[0] === 127) return true; // loopback
    if (p[0] === 169 && p[1] === 254) return true; // link-local + metadata nube
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // privada
    if (p[0] === 192 && p[1] === 168) return true; // privada
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }

  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true; // loopback / unspecified
  if (low.startsWith('fe80')) return true; // link-local
  if (low.startsWith('fc') || low.startsWith('fd')) return true; // ULA
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

/**
 * Valida que `rawUrl` sea un destino http(s) público y seguro. Lanza AppError
 * (400) si no. Devuelve la URL parseada para reutilizarla en el fetch.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new AppError(400, 'URL inválida');
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new AppError(400, 'Solo se permiten URLs http(s)');
  }

  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new AppError(400, 'Host no permitido');
  }

  // IP literal: chequeo directo. Nombre DNS: resolvemos y validamos todas.
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new AppError(400, 'Host no permitido (rango privado)');
    return u;
  }

  let addrs: { address: string }[];
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new AppError(400, 'No se pudo resolver el host');
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new AppError(400, 'Host no permitido (resuelve a un rango privado)');
  }
  return u;
}
