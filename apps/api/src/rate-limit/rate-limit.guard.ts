import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service';

const DEFAULT_IP_CAPACITY = 100;
const DEFAULT_IP_REFILL_PER_SEC = 20;
const DEFAULT_USER_CAPACITY = 60;
const DEFAULT_USER_REFILL_PER_SEC = 10;

/**
 * Global guard (registered via APP_GUARD, issue #12) — runs on every route,
 * authenticated or not. IP bucket covers unauthenticated abuse (e.g. signup
 * spam); user bucket is checked in addition whenever a valid JWT is present.
 * Decodes the token itself (rather than reading request.user) because a
 * global guard runs before any route's JwtAuthGuard populates it.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly ipCapacity: number;
  private readonly ipRefillPerSec: number;
  private readonly userCapacity: number;
  private readonly userRefillPerSec: number;

  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly jwt: JwtService,
  ) {
    this.ipCapacity = Number(process.env.RATE_LIMIT_IP_CAPACITY) || DEFAULT_IP_CAPACITY;
    this.ipRefillPerSec = Number(process.env.RATE_LIMIT_IP_REFILL_PER_SEC) || DEFAULT_IP_REFILL_PER_SEC;
    this.userCapacity = Number(process.env.RATE_LIMIT_USER_CAPACITY) || DEFAULT_USER_CAPACITY;
    this.userRefillPerSec =
      Number(process.env.RATE_LIMIT_USER_REFILL_PER_SEC) || DEFAULT_USER_REFILL_PER_SEC;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const ipResult = await this.rateLimit.consume(`rl:ip:${ip}`, this.ipCapacity, this.ipRefillPerSec);
    if (!ipResult.allowed) {
      this.reject(res, ipResult.retryAfterSeconds);
    }

    const userId = this.extractUserId(req);
    if (userId) {
      const userResult = await this.rateLimit.consume(
        `rl:user:${userId}`,
        this.userCapacity,
        this.userRefillPerSec,
      );
      if (!userResult.allowed) {
        this.reject(res, userResult.retryAfterSeconds);
      }
    }

    return true;
  }

  private extractUserId(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }
    try {
      const payload = this.jwt.verify(header.slice('Bearer '.length)) as { sub?: string };
      return payload.sub;
    } catch {
      return undefined;
    }
  }

  private reject(res: Response, retryAfterSeconds: number): never {
    const retryAfter = Math.max(1, retryAfterSeconds);
    res.setHeader('Retry-After', String(retryAfter));
    throw new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many requests', retryAfterSeconds: retryAfter },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
