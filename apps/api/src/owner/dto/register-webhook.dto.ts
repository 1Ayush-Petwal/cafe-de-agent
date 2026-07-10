import { IsUrl } from 'class-validator';

/**
 * `require_tld: false` deliberately accepts bare-IP/localhost URLs — a
 * café's "local app" (issue #24) may live on a LAN or a dev machine with no
 * public domain name.
 */
export class RegisterWebhookDto {
  @IsUrl({ require_tld: false, require_protocol: true })
  url!: string;
}
