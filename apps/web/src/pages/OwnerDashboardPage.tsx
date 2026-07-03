import { FormEvent, useEffect, useState } from 'react';
import { ApiError, CafeDto, OwnerBookingDto, OwnerTableDto, api } from '../api/client';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleString([], { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
}

export function OwnerDashboardPage() {
  const [cafes, setCafes] = useState<CafeDto[]>([]);
  const [selectedCafeId, setSelectedCafeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cafeName, setCafeName] = useState('');
  const [cafeArea, setCafeArea] = useState('');

  const [tables, setTables] = useState<OwnerTableDto[]>([]);
  const [tableLabel, setTableLabel] = useState('');
  const [tableCapacity, setTableCapacity] = useState(2);

  const [gridStartDate, setGridStartDate] = useState(todayIso());
  const [gridDays, setGridDays] = useState(14);
  const [gridOpenHour, setGridOpenHour] = useState(9);
  const [gridCloseHour, setGridCloseHour] = useState(22);
  const [gridTurnTime, setGridTurnTime] = useState(60);
  const [gridMessage, setGridMessage] = useState<string | null>(null);

  const [bookingsDate, setBookingsDate] = useState(todayIso());
  const [bookings, setBookings] = useState<OwnerBookingDto[]>([]);

  const loadCafes = () => {
    api
      .ownerListCafes()
      .then((result) => {
        setCafes(result);
        setSelectedCafeId((current) => current ?? result[0]?.id ?? null);
      })
      .catch(() => setError('Could not load your cafés'));
  };

  useEffect(loadCafes, []);

  const loadTables = (cafeId: string) => {
    api
      .ownerListTables(cafeId)
      .then(setTables)
      .catch(() => setError('Could not load tables'));
  };

  const loadBookings = (cafeId: string, date: string) => {
    api
      .ownerBookingsForDay(cafeId, date)
      .then(setBookings)
      .catch(() => setError('Could not load bookings'));
  };

  useEffect(() => {
    if (!selectedCafeId) return;
    loadTables(selectedCafeId);
    loadBookings(selectedCafeId, bookingsDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCafeId]);

  const handleCreateCafe = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const cafe = await api.ownerCreateCafe(cafeName, cafeArea);
      setCafeName('');
      setCafeArea('');
      setCafes((prev) => [...prev, cafe]);
      setSelectedCafeId(cafe.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create café');
    }
  };

  const handleCreateTable = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCafeId) return;
    setError(null);
    try {
      await api.ownerCreateTable(selectedCafeId, tableLabel, tableCapacity);
      setTableLabel('');
      setTableCapacity(2);
      loadTables(selectedCafeId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create table');
    }
  };

  const handleToggleInService = async (table: OwnerTableDto) => {
    if (!selectedCafeId) return;
    setError(null);
    try {
      await api.ownerUpdateTable(selectedCafeId, table.id, { inService: !table.inService });
      loadTables(selectedCafeId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update table');
    }
  };

  const handleGenerateSlots = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCafeId) return;
    setError(null);
    setGridMessage(null);
    try {
      const created = await api.ownerGenerateSlots(selectedCafeId, {
        startDate: gridStartDate,
        days: gridDays,
        openHour: gridOpenHour,
        closeHour: gridCloseHour,
        turnTimeMinutes: gridTurnTime,
      });
      setGridMessage(`Created ${created.length} new slot(s).`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate slot grid');
    }
  };

  const handleBookingsDateChange = (date: string) => {
    setBookingsDate(date);
    if (selectedCafeId) loadBookings(selectedCafeId, date);
  };

  return (
    <div>
      <h1>Owner dashboard</h1>
      {error && <p className="error">{error}</p>}

      <h2>Create a café</h2>
      <form onSubmit={handleCreateCafe}>
        <label>
          Name
          <input required value={cafeName} onChange={(e) => setCafeName(e.target.value)} />
        </label>
        <label>
          Area
          <input required value={cafeArea} onChange={(e) => setCafeArea(e.target.value)} />
        </label>
        <button type="submit">Create café</button>
      </form>

      {cafes.length > 0 && (
        <>
          <h2>Your cafés</h2>
          <label>
            Café
            <select value={selectedCafeId ?? ''} onChange={(e) => setSelectedCafeId(e.target.value)}>
              {cafes.map((cafe) => (
                <option key={cafe.id} value={cafe.id}>
                  {cafe.name} ({cafe.area})
                </option>
              ))}
            </select>
          </label>

          {selectedCafeId && (
            <>
              <h2>Tables</h2>
              <ul className="reservation-list">
                {tables.map((table) => (
                  <li key={table.id}>
                    {table.label} — seats {table.capacity} —{' '}
                    <span className={`status ${table.inService ? 'status-booked' : 'status-cancelled'}`}>
                      {table.inService ? 'in service' : 'out of service'}
                    </span>
                    <button onClick={() => handleToggleInService(table)}>
                      {table.inService ? 'Take out of service' : 'Put back in service'}
                    </button>
                  </li>
                ))}
              </ul>
              <form onSubmit={handleCreateTable}>
                <label>
                  Label
                  <input required value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} />
                </label>
                <label>
                  Capacity
                  <input
                    type="number"
                    min={1}
                    required
                    value={tableCapacity}
                    onChange={(e) => setTableCapacity(Number(e.target.value))}
                  />
                </label>
                <button type="submit">Add table</button>
              </form>

              <h2>Daily slot grid</h2>
              <form onSubmit={handleGenerateSlots}>
                <label>
                  Start date
                  <input
                    type="date"
                    value={gridStartDate}
                    onChange={(e) => setGridStartDate(e.target.value)}
                  />
                </label>
                <label>
                  Days ahead
                  <input
                    type="number"
                    min={1}
                    value={gridDays}
                    onChange={(e) => setGridDays(Number(e.target.value))}
                  />
                </label>
                <label>
                  Opening hour (UTC)
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={gridOpenHour}
                    onChange={(e) => setGridOpenHour(Number(e.target.value))}
                  />
                </label>
                <label>
                  Closing hour (UTC)
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={gridCloseHour}
                    onChange={(e) => setGridCloseHour(Number(e.target.value))}
                  />
                </label>
                <label>
                  Turn time (minutes)
                  <input
                    type="number"
                    min={15}
                    value={gridTurnTime}
                    onChange={(e) => setGridTurnTime(Number(e.target.value))}
                  />
                </label>
                <button type="submit">Generate slot grid</button>
              </form>
              {gridMessage && <p>{gridMessage}</p>}

              <h2>Bookings</h2>
              <label>
                Date
                <input
                  type="date"
                  value={bookingsDate}
                  onChange={(e) => handleBookingsDateChange(e.target.value)}
                />
              </label>
              {bookings.length === 0 ? (
                <p>No bookings for this day.</p>
              ) : (
                <ul className="reservation-list">
                  {bookings.map((b) => (
                    <li key={b.id}>
                      Table {b.table.label} — {formatSlotTime(b.slot.slotTime)} — {b.user.email}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
