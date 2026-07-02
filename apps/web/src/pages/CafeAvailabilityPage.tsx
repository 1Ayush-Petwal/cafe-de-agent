import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, TableAvailabilityDto } from '../api/client';
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
  const [booking, setBooking] = useState<string | null>(null);

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

  const handleBook = async (tableId: string, slotId: string) => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    setError(null);
    setBooking(`${tableId}:${slotId}`);
    try {
      await api.book(tableId, slotId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not book that slot');
    } finally {
      setBooking(null);
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
                        disabled={booking === `${table.tableId}:${slot.slotId}`}
                        onClick={() => handleBook(table.tableId, slot.slotId)}
                      >
                        {booking === `${table.tableId}:${slot.slotId}` ? '…' : 'Book'}
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
