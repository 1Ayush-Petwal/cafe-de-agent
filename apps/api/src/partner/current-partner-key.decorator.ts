import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PartnerApiKeyContext } from './api-key.guard';

export const CurrentPartnerKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PartnerApiKeyContext => {
    return ctx.switchToHttp().getRequest().partnerApiKey;
  },
);
