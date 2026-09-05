import { FormEvent, useState } from 'react';
import { ApiError, MandateDto, api } from '../api/client';
import { formatRupees } from '../money';

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const now = new Date();
const inAWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

/**
 * Issue #4 (PRD area B): a minimal grant form — this slice only creates,
 * reads and revokes the signed mandate artifact, so there is nothing here
 * yet for the agent to consult. Enforcement is issue #5.
 */
export function MandatePage() {
  const [maxPerBookingRupees, setMaxPerBookingRupees] = useState('600');
  const [maxTotalRupees, setMaxTotalRupees] = useState('1500');
  const [maxBookings, setMaxBookings] = useState('3');
  const [allowedLocalities, setAllowedLocalities] = useState('Hauz Khas, GK-II');
  const [windowStart, setWindowStart] = useState(toDatetimeLocal(now));
  const [windowEnd, setWindowEnd] = useState(toDatetimeLocal(inAWeek));
  const [mandate, setMandate] = useState<MandateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleGrant = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const granted = await api.grantMandate({
        maxPerBookingMinor: Math.round(Number(maxPerBookingRupees) * 100),
        maxTotalMinor: Math.round(Number(maxTotalRupees) * 100),
        maxBookings: Number(maxBookings),
        allowedLocalities: allowedLocalities
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        windowStart: new Date(windowStart).toISOString(),
        windowEnd: new Date(windowEnd).toISOString(),
      });
      setMandate(granted);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not grant mandate');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!mandate) return;
    setError(null);
    setBusy(true);
    try {
      setMandate(await api.revokeMandate(mandate.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke mandate');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Agent mandate</h1>
      <p>Grant your booking agent a bounded, signed authority to book on your behalf.</p>
      {error && <p className="error">{error}</p>}

      {!mandate || mandate.status === 'revoked' ? (
        <form onSubmit={handleGrant} className="mandate-form form-stacked">
          <label>
            Max per booking (₹)
            <input
              type="number"
              min="1"
              value={maxPerBookingRupees}
              onChange={(e) => setMaxPerBookingRupees(e.target.value)}
              required
            />
          </label>
          <label>
            Max total (₹)
            <input
              type="number"
              min="1"
              value={maxTotalRupees}
              onChange={(e) => setMaxTotalRupees(e.target.value)}
              required
            />
          </label>
          <label>
            Max bookings
            <input
              type="number"
              min="1"
              value={maxBookings}
              onChange={(e) => setMaxBookings(e.target.value)}
              required
            />
          </label>
          <label>
            Allowed localities (comma-separated)
            <input
              type="text"
              value={allowedLocalities}
              onChange={(e) => setAllowedLocalities(e.target.value)}
              required
            />
          </label>
          <div className="form-row">
            <label>
              Valid from
              <input
                type="datetime-local"
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
                required
              />
            </label>
            <label>
              Valid until
              <input
                type="datetime-local"
                value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)}
                required
              />
            </label>
          </div>
          <button type="submit" disabled={busy}>
            Grant mandate
          </button>
        </form>
      ) : (
        <div className="mandate-status">
          <p>
            Status: <strong>{mandate.status}</strong>
          </p>
          <p>
            Remaining budget: {formatRupees(mandate.remainingMinor)} of {formatRupees(mandate.maxTotalMinor)}
          </p>
          <p>
            Remaining bookings: {mandate.remainingBookings} of {mandate.maxBookings}
          </p>
          <p>Expires: {new Date(mandate.expiresAt).toLocaleString()}</p>
          <p>Allowed localities: {mandate.allowedLocalities.join(', ')}</p>
          <button onClick={handleRevoke} disabled={busy}>
            Revoke mandate
          </button>
        </div>
      )}
    </div>
  );
}
