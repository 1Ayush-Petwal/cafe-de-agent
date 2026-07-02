import { Injectable } from '@nestjs/common';

/**
 * The mock delivery channel (issue #6). Like PaymentsService's charge
 * toggle (issue #5), the failure switch is a deliberate test seam: the
 * acceptance criteria require proving retries + dead-lettering on command,
 * not by chance.
 */
@Injectable()
export class NotifierService {
  private forceFailure = false;

  setForceFailure(fail: boolean): void {
    this.forceFailure = fail;
  }

  async deliver(): Promise<void> {
    if (this.forceFailure) {
      throw new Error('Notifier outage (forced)');
    }
  }
}
