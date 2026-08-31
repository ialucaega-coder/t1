import { Request, Response, NextFunction } from 'express';

const windowMs = 15 * 60 * 1000;
const maxRequests = 100;
const authMaxRequests = 10;

const hits = new Map<string, { count: number; resetAt: number }>();

function getKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function rateLimit(max = maxRequests) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'development') {
      return next();
    }

    const key = getKey(req);
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > max) {
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return;
    }

    next();
  };
}

export const authRateLimit = rateLimit(authMaxRequests);
export const apiRateLimit = rateLimit(maxRequests);

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) {
    if (now > entry.resetAt) hits.delete(key);
  }
}, 60_000);
