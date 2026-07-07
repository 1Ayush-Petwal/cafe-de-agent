import { Injectable } from '@nestjs/common';

export interface NominatimResult {
  lat: number;
  lon: number;
  displayName: string;
}

/**
 * Wraps Nominatim (OpenStreetMap's free geocoder) behind one injectable
 * class — the established mock-gateway pattern (PaymentsService,
 * AgentLlmClient): tests queue a stubbed response via `stub()`, which
 * short-circuits `search()` before it ever reaches the network.
 */
@Injectable()
export class NominatimClient {
  private stubbed: NominatimResult[] | undefined;
  private lastCallAt = 0;

  /** Test-only: force the next search() call(s) to return this. */
  stub(results: NominatimResult[]): void {
    this.stubbed = results;
  }

  clearStub(): void {
    this.stubbed = undefined;
  }

  async search(query: string, viewbox: string): Promise<NominatimResult[]> {
    if (this.stubbed !== undefined) {
      return this.stubbed;
    }

    await this.throttle();

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('viewbox', viewbox);
    url.searchParams.set('bounded', '1');

    const res = await fetch(url, {
      headers: { 'User-Agent': 'kaforia-cafe-locator/1.0 (store locator geocoding)' },
    });
    if (!res.ok) {
      throw new Error(`Nominatim request failed: ${res.status}`);
    }
    const body = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    return body.map((r) => ({ lat: Number(r.lat), lon: Number(r.lon), displayName: r.display_name }));
  }

  /**
   * Nominatim's usage policy caps external callers at 1 request/sec. Every
   * locality search in the app is proxied through this one client (never
   * called directly from the browser), so throttling here — rather than per
   * caller — is enough to honor that limit regardless of how many concurrent
   * users are searching.
   */
  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastCallAt;
    const wait = 1000 - elapsed;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastCallAt = Date.now();
  }
}
