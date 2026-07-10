import { createHash } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PartnerApiKey } from '../entities/partner-api-key.entity';

export interface PartnerApiKeyContext {
  cafeId: string;
}

/**
 * Authenticates a Partner API request via the `X-Api-Key` header (issue
 * #24, PRD area G). The raw key is never stored — this hashes the presented
 * key the same way `OwnerService.generatePartnerApiKey` hashed it and looks
 * up by hash, so a DB leak alone can't forge a valid key. A missing header,
 * an unknown hash, and a revoked key are all indistinguishable 401s — no
 * oracle for "does this key exist".
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@InjectRepository(PartnerApiKey) private readonly keys: Repository<PartnerApiKey>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['x-api-key'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) {
      throw new UnauthorizedException('Missing X-Api-Key header');
    }

    const keyHash = createHash('sha256').update(raw).digest('hex');
    const key = await this.keys.findOne({ where: { keyHash } });
    if (!key || key.revokedAt) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    (request as { partnerApiKey?: PartnerApiKeyContext }).partnerApiKey = { cafeId: key.cafeId };
    return true;
  }
}
