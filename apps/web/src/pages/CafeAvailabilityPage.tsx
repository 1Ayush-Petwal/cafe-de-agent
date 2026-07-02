import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, HoldDto, api, TableAvailabilityDto } from '../api/client';
import { useAuth } from '../auth/AuthContext';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

export function CafeAvailabilityPage() {
  const { cafeId } = useParams<{ cafeId: string }>();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [date, setDate] = useState(todayIso());
  const [tables, setTables] = useState<TableAvailabilityDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holding, setHolding] = useState<string | null>(null);
  const [hold, setHold] = useState<HoldDto | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [confirming, setConfirming] = useState(false);

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

  // Countdown ticker for the active hold; once it hits zero the hold has
  // expired server-side too (Redis TTL), so drop it and refresh the grid.
  useEffect(() => {
    if (!hold) return;
    const tick = () => {
      const remaining = Math.max(0, Math.round((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setHold(null);
        setError('Your hold expired — please try again');
        load();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [hold, load]);

  const handleHold = async (tableId: string, slotId: string) => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    setError(null);
    setHolding(`${tableId}:${slotId}`);
    try {
      const newHold = await api.hold(tableId, slotId);
      setHold(newHold);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not hold that slot');
    } finally {
      setHolding(null);
    }
  };

  const handleConfirm = async () => {
    if (!hold) return;
    setConfirming(true);
    setError(null);
    try {
      await api.confirmHold(hold.holdId, hold.tableId, hold.slotId);
      setHold(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm that booking');
      setHold(null);
      load();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div>
      <h1>Availability</h1>
      <label>
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      {hold && (
        <div className="hold-banner">
          <span>
            Table held — confirm within <strong>{secondsLeft}s</strong>
          </span>
          <button disabled={confirming} onClick={handleConfirm}>
            {confirming ? '…' : 'Confirm booking'}
          </button>
        </div>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="availability-grid">
          <thead>
            <tr>
              <th>Table</th>
              {tables[0]?.slots.map((slot) => (
                <th key={slot.slotId}>{formatSlotTime(slot.slotTime)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tables.map((table) => (
              <tr key={table.tableId}>
                <td>
                  {table.label} (seats {table.capacity})
                </td>
                {table.slots.map((slot) => (
                  <td key={slot.slotId}>
                    {slot.available ? (
                      <button
                        disabled={!!hold || holding === `${table.tableId}:${slot.slotId}`}
                        onClick={() => handleHold(table.tableId, slot.slotId)}
                      >
                        {holding === `${table.tableId}:${slot.slotId}` ? '…' : 'Book'}
                      </button>
                    ) : (
                      <span className="unavailable">Taken</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
