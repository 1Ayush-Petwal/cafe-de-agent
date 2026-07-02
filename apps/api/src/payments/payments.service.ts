import { Injectable } from '@nestjs/common';

/**
 * Mock gateway (issue #5). The failure toggle is a product feature, not a
 * test convenience — the saga's pay step (M5) needs a deterministic way to
 * fail so compensation (releasing the hold) is exercised on command rather
 * than by chance.
 */
@Injectable()
export class PaymentsService {
  private forceFailure = false;

  setForceFailure(fail: boolean): void {
    this.forceFailure = fail;
  }

  async charge(): Promise<boolean> {
    return !this.forceFailure;
  }
}
