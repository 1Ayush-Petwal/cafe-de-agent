import { Injectable } from '@nestjs/common';

/**
 * The Partner API's real outbound leg (issue #24, PRD area G). Unlike the
 * mock in-app NotifierService (issue #6), a webhook genuinely has to reach a
 * URL the café owner controls — there's no in-app substitute for "did their
 * server get the POST". Kept behind one injectable class anyway (the
 * established mock-gateway DI seam — PaymentsService, AgentLlmClient,
 * NominatimClient) so WebhookWorkerService never talks to `fetch` directly;
 * tests point real URLs at a local HTTP server they control rather than
 * stubbing this out.
 */
@Injectable()
export class WebhookDeliveryClient {
  async deliver(url: string, payload: Record<string, unknown>): Promise<void> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Webhook delivery failed: ${res.status}`);
    }
  }
}
