import { useEffect, useState } from 'react';
import { ApiError, api, ReservationDto } from '../api/client';

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleString([], { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
}

export function MyReservationsPage() {
  const [reservations, setReservations] = useState<ReservationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .myReservations()
      .then(setReservations)
      .catch(() => setError('Could not load reservations'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCancel = async (id: string) => {
    setError(null);
    try {
      await api.cancel(id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel');
    }
  };

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <h1>My reservations</h1>
      {error && <p className="error">{error}</p>}
      {reservations.length === 0 ? (
        <p>No reservations yet.</p>
      ) : (
        <ul className="reservation-list">
          {reservations.map((r) => (
            <li key={r.id} className={r.status}>
              <strong>{r.table.cafe.name}</strong> — table {r.table.label} —{' '}
              {formatSlotTime(r.slot.slotTime)}
              <span className={`status status-${r.status}`}>{r.status}</span>
              {r.status === 'booked' && <button onClick={() => handleCancel(r.id)}>Cancel</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
