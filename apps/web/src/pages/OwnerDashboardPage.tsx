import { ChangeEvent, FocusEvent, FormEvent, useEffect, useState } from 'react';
import {
  ApiError,
  CafeDto,
  OwnerBookingDto,
  OwnerTableDto,
  PartnerApiKeyDto,
  WebhookEndpointDto,
  api,
} from '../api/client';

const DAYS_AHEAD_MIN = 1;
const DAYS_AHEAD_MAX = 60;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleString([], { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
}

/** Matches the API's own days-ahead bounds (`GenerateSlotsDto`) so the number shown is the number submitted. */
function clampDaysAhead(raw: string): number {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DAYS_AHEAD_MIN;
  return Math.min(DAYS_AHEAD_MAX, Math.max(DAYS_AHEAD_MIN, parsed));
}

export function OwnerDashboardPage() {
  const [cafes, setCafes] = useState<CafeDto[]>([]);
  const [selectedCafeId, setSelectedCafeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cafeName, setCafeName] = useState('');
  const [cafeArea, setCafeArea] = useState('');

  const [cuisinesInput, setCuisinesInput] = useState('');
  const [cuisinesMessage, setCuisinesMessage] = useState<string | null>(null);

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

  const [partnerKeys, setPartnerKeys] = useState<PartnerApiKeyDto[]>([]);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [webhookEndpoint, setWebhookEndpoint] = useState<WebhookEndpointDto | null>(null);
  const [webhookUrlInput, setWebhookUrlInput] = useState('');
  const [webhookMessage, setWebhookMessage] = useState<string | null>(null);

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

  const loadPartnerKeys = (cafeId: string) => {
    api
      .ownerListPartnerApiKeys(cafeId)
      .then(setPartnerKeys)
      .catch(() => setError('Could not load partner API keys'));
  };

  const loadWebhookEndpoint = (cafeId: string) => {
    api
      .ownerGetWebhookEndpoint(cafeId)
      .then((endpoint) => {
        setWebhookEndpoint(endpoint);
        setWebhookUrlInput(endpoint?.url ?? '');
      })
      .catch(() => setError('Could not load webhook endpoint'));
  };

  useEffect(() => {
    if (!selectedCafeId) return;
    loadTables(selectedCafeId);
    loadBookings(selectedCafeId, bookingsDate);
    loadPartnerKeys(selectedCafeId);
    loadWebhookEndpoint(selectedCafeId);
    const cafe = cafes.find((c) => c.id === selectedCafeId);
    setCuisinesInput((cafe?.cuisines ?? []).join(', '));
    setCuisinesMessage(null);
    setNewApiKey(null);
    setWebhookMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCafeId, cafes]);

  const handleCreateCafe = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const cafe = await api.ownerCreateCafe({ name: cafeName, area: cafeArea });
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

  const handleSaveCuisines = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCafeId) return;
    setError(null);
    setCuisinesMessage(null);
    const cuisines = cuisinesInput
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    try {
      const updated = await api.ownerUpdateCafe(selectedCafeId, { cuisines });
      setCafes((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setCuisinesMessage('Cuisines saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save cuisines');
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
      const newDays = new Set(created.map((slot) => slot.slotTime.slice(0, 10))).size;
      const skippedDays = gridDays - newDays;
      setGridMessage(
        `Created ${created.length} slots across ${newDays} new days ` +
          `(${skippedDays} days already had slots — skipped).`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate slot grid');
    }
  };

  const handleDaysAheadChange = (e: ChangeEvent<HTMLInputElement>) => {
    // Left blank mid-edit (e.g. select-all then retype) rather than snapping to
    // the min, so clearing the field to type a fresh number doesn't fight the
    // owner's keystrokes.
    if (e.target.value === '') return;
    const clamped = clampDaysAhead(e.target.value);
    setGridDays(clamped);
    // React bails out of touching the DOM when the computed state equals the
    // previous state (e.g. "14" -> "014", both parse to 14) — this is the
    // sticky-leading-zero bug from the issue. Writing the input's value directly
    // forces the display to match what's actually being submitted.
    e.target.value = String(clamped);
  };

  const handleDaysAheadBlur = (e: FocusEvent<HTMLInputElement>) => {
    if (e.target.value === '') e.target.value = String(gridDays);
  };

  const handleBookingsDateChange = (date: string) => {
    setBookingsDate(date);
    if (selectedCafeId) loadBookings(selectedCafeId, date);
  };

  const handleGenerateApiKey = async () => {
    if (!selectedCafeId) return;
    setError(null);
    try {
      const generated = await api.ownerGeneratePartnerApiKey(selectedCafeId);
      setNewApiKey(generated.apiKey ?? null);
      loadPartnerKeys(selectedCafeId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate API key');
    }
  };

  const handleRevokeApiKey = async (keyId: string) => {
    if (!selectedCafeId) return;
    setError(null);
    try {
      await api.ownerRevokePartnerApiKey(selectedCafeId, keyId);
      loadPartnerKeys(selectedCafeId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke API key');
    }
  };

  const handleRegisterWebhook = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCafeId) return;
    setError(null);
    setWebhookMessage(null);
    try {
      const endpoint = await api.ownerRegisterWebhookEndpoint(selectedCafeId, webhookUrlInput);
      setWebhookEndpoint(endpoint);
      setWebhookMessage('Webhook endpoint saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save webhook endpoint');
    }
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
              <h2>Cuisines</h2>
              <form onSubmit={handleSaveCuisines}>
                <label>
                  Cuisines (comma-separated)
                  <input
                    value={cuisinesInput}
                    placeholder="Italian, Continental, Asian"
                    onChange={(e) => setCuisinesInput(e.target.value)}
                  />
                </label>
                <button type="submit">Save cuisines</button>
              </form>
              {cuisinesMessage && <p>{cuisinesMessage}</p>}

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
                    min={DAYS_AHEAD_MIN}
                    max={DAYS_AHEAD_MAX}
                    value={gridDays}
                    onChange={handleDaysAheadChange}
                    onBlur={handleDaysAheadBlur}
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

              <h2>Partner API</h2>
              <p>
                Let your café's local app receive booking webhooks and pull bookings/availability via
                the Partner API. Issue #24.
              </p>

              <h3>API keys</h3>
              {newApiKey && (
                <p className="notice">
                  New key: <code>{newApiKey}</code> — copy it now, it won't be shown again.
                </p>
              )}
              {partnerKeys.length === 0 ? (
                <p>No API keys yet.</p>
              ) : (
                <ul className="reservation-list">
                  {partnerKeys.map((key) => (
                    <li key={key.id}>
                      <code>{key.keyPrefix}…</code> —{' '}
                      <span className={`status ${key.revokedAt ? 'status-cancelled' : 'status-booked'}`}>
                        {key.revokedAt ? 'revoked' : 'active'}
                      </span>
                      {!key.revokedAt && <button onClick={() => handleRevokeApiKey(key.id)}>Revoke</button>}
                    </li>
                  ))}
                </ul>
              )}
              <button onClick={handleGenerateApiKey}>Generate new key</button>

              <h3>Webhook endpoint</h3>
              <form onSubmit={handleRegisterWebhook}>
                <label>
                  Your local app's URL
                  <input
                    type="url"
                    required
                    placeholder="https://your-cafe-app.example.com/webhooks/kaforia"
                    value={webhookUrlInput}
                    onChange={(e) => setWebhookUrlInput(e.target.value)}
                  />
                </label>
                <button type="submit">{webhookEndpoint ? 'Update endpoint' : 'Register endpoint'}</button>
              </form>
              {webhookMessage && <p>{webhookMessage}</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
