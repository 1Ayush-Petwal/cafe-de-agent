import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, HoldDto, api, TableAvailabilityDto } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const DATE_PILL_COUNT = 7;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

/** Next few days as tappable pills — UTC day boundaries, matching todayIso(). */
function dateOptions(): { iso: string; label: string }[] {
  const now = Date.now();
  return Array.from({ length: DATE_PILL_COUNT }, (_, i) => {
    const d = new Date(now + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    const label =
      i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    return { iso, label };
  });
}

export function CafeAvailabilityPage() {
  const { cafeId } = useParams<{ cafeId: string }>();
  const { isAuthenticated, adjustWalletBalance } = useAuth();
  const navigate = useNavigate();
  const [date, setDate] = useState(todayIso());
  const [tables, setTables] = useState<TableAvailabilityDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [holding, setHolding] = useState<string | null>(null);
  const [hold, setHold] = useState<HoldDto | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [confirming, setConfirming] = useState(false);
  // One idempotency key per hold, reused for every confirm attempt against
  // it (double-click, or a manual retry after an error) — see api.confirmHold.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!cafeId) return;
    setLoading(true);
    api
      .getAvailability(cafeId, date)
      .then(setTables)
      .catch(() => setError('Could not load availability'))
      .finally(() => setLoading(false));
  }, [cafeId, date]);

  useEffect(() => {
    load();
  }, [load]);

  // M4 (issue #7): live grid updates via SSE — any hold/confirm/cancel by
  // anyone else on this café refetches availability without a manual reload.
  useEffect(() => {
    if (!cafeId) return;
    return api.subscribeAvailability(cafeId, load);
  }, [cafeId, load]);

  // Default to the first slot pill whenever the day's slots change (new
  // date, or the grid reloading); drop the selection entirely if it's gone.
  useEffect(() => {
    const slotIds = tables[0]?.slots.map((s) => s.slotId) ?? [];
    setSelectedSlotId((prev) => (prev && slotIds.includes(prev) ? prev : (slotIds[0] ?? null)));
  }, [tables]);

  // Countdown ticker for the active hold; once it hits zero the hold has
  // expired server-side too (Redis TTL), so drop it and refresh the grid.
  useEffect(() => {
    if (!hold) return;
    const tick = () => {
      const remaining = Math.max(0, Math.round((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setHold(null);
        setSelectedTableId(null);
        setError('Your hold expired — please try again');
        load();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [hold, load]);

  const handleDateSelect = (iso: string) => {
    setDate(iso);
    setSelectedTableId(null);
  };

  const handleSlotSelect = (slotId: string) => {
    setSelectedSlotId(slotId);
    setSelectedTableId(null);
  };

  const handleReserve = async () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!selectedTableId || !selectedSlotId) return;
    setError(null);
    setHolding(`${selectedTableId}:${selectedSlotId}`);
    try {
      const newHold = await api.hold(selectedTableId, selectedSlotId);
      setHold(newHold);
      setConfirmKey(crypto.randomUUID());
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not hold that slot');
    } finally {
      setHolding(null);
    }
  };

  const handleConfirm = async () => {
    if (!hold || !confirmKey) return;
    setConfirming(true);
    setError(null);
    try {
      await api.confirmHold(hold.holdId, hold.tableId, hold.slotId, confirmKey);
      adjustWalletBalance(-25);
      setHold(null);
      setSelectedTableId(null);
      setConfirmKey(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm that booking');
      setHold(null);
      setSelectedTableId(null);
      setConfirmKey(null);
      load();
    } finally {
      setConfirming(false);
    }
  };

  const slots = tables[0]?.slots ?? [];

  return (
    <div>
      <h1>Reserve a table</h1>
      {error && <p className="error">{error}</p>}
      {hold && (
        <div className="hold-banner">
          <span>
            Table held — confirm within <strong>{secondsLeft}s</strong>
          </span>
          <button disabled={confirming} onClick={handleConfirm}>
            {confirming ? '…' : 'Confirm — ₹25'}
          </button>
        </div>
      )}
      <div className="pill-row date-pills" role="tablist" aria-label="Date">
        {dateOptions().map((d) => (
          <button
            key={d.iso}
            type="button"
            role="tab"
            aria-selected={date === d.iso}
            className={`pill${date === d.iso ? ' pill-selected' : ''}`}
            disabled={!!hold}
            onClick={() => handleDateSelect(d.iso)}
          >
            {d.label}
          </button>
        ))}
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="pill-row slot-pills" role="tablist" aria-label="Time slot">
            {slots.map((slot) => (
              <button
                key={slot.slotId}
                type="button"
                role="tab"
                aria-selected={selectedSlotId === slot.slotId}
                className={`pill${selectedSlotId === slot.slotId ? ' pill-selected' : ''}`}
                disabled={!!hold}
                onClick={() => handleSlotSelect(slot.slotId)}
              >
                {formatSlotTime(slot.slotTime)}
              </button>
            ))}
            {slots.length === 0 && <p>No slots for this date.</p>}
          </div>
          <div className="table-cards">
            {tables.map((table) => {
              const slot = table.slots.find((s) => s.slotId === selectedSlotId);
              const available = slot?.available ?? false;
              return (
                <button
                  key={table.tableId}
                  type="button"
                  className={`table-card${selectedTableId === table.tableId ? ' selected' : ''}${available ? '' : ' reserved'}`}
                  disabled={!selectedSlotId || !available || !!hold}
                  onClick={() => setSelectedTableId(table.tableId)}
                >
                  <span className="table-label">
                    {table.label} · {table.capacity} seats
                  </span>
                  {!available && <span className="reserved-badge">Reserved</span>}
                </button>
              );
            })}
          </div>
          <button
            className="reserve-cta"
            disabled={!selectedTableId || !selectedSlotId || !!hold || holding === `${selectedTableId}:${selectedSlotId}`}
            onClick={handleReserve}
          >
            {holding ? '…' : 'Reserve a Table'}
          </button>
        </>
      )}
    </div>
  );
}
