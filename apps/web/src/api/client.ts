const TOKEN_KEY = 'cafe-de-app:token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export interface AuthResponse {
  accessToken: string;
  user: { id: string; email: string; role: string };
}

export interface CafeDto {
  id: string;
  name: string;
  area: string;
  description: string;
}

export interface AvailabilitySlotDto {
  slotId: string;
  slotTime: string;
  available: boolean;
}

export interface TableAvailabilityDto {
  tableId: string;
  label: string;
  capacity: number;
  slots: AvailabilitySlotDto[];
}

export interface ReservationDto {
  id: string;
  tableId: string;
  slotId: string;
  status: 'booked' | 'cancelled';
  createdAt: string;
  table: { id: string; label: string; capacity: number; cafe: CafeDto };
  slot: { id: string; slotTime: string };
}

export interface HoldDto {
  holdId: string;
  tableId: string;
  slotId: string;
  expiresAt: string;
}

export interface OwnerTableDto {
  id: string;
  cafeId: string;
  label: string;
  capacity: number;
  inService: boolean;
}

export interface AgentTurnDto {
  role: 'user' | 'model';
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface AgentWorkflowDto {
  id: string;
  status: 'pending' | 'awaiting_approval' | 'awaiting_input' | 'done' | 'failed';
  request: string;
  history: AgentTurnDto[];
  pendingAction: { name: string; args: Record<string, unknown> } | null;
  reservationId: string | null;
  failureReason: string | null;
}

export interface OwnerBookingDto {
  id: string;
  tableId: string;
  slotId: string;
  status: 'booked' | 'cancelled';
  table: { id: string; label: string; capacity: number };
  slot: { id: string; slotTime: string };
  user: { id: string; email: string };
}

export const api = {
  signup: (email: string, password: string, role?: 'customer' | 'owner') =>
    request<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(role ? { role } : {}) }),
    }),
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  listCafes: () => request<CafeDto[]>('/cafes'),
  getAvailability: (cafeId: string, date: string) =>
    request<TableAvailabilityDto[]>(`/cafes/${cafeId}/availability?date=${date}`),
  hold: (tableId: string, slotId: string) =>
    request<HoldDto>('/reservations/hold', { method: 'POST', body: JSON.stringify({ tableId, slotId }) }),
  // M6 (issue #11): the Idempotency-Key is generated once per hold (see
  // CafeAvailabilityPage) and reused across every confirm attempt for that
  // hold, so a double-click or a retry-after-error never re-charges or
  // re-books — the server replays the first attempt's stored result.
  confirmHold: (holdId: string, tableId: string, slotId: string, idempotencyKey: string) =>
    request<ReservationDto>('/reservations/confirm', {
      method: 'POST',
      body: JSON.stringify({ holdId, tableId, slotId }),
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  myReservations: () => request<ReservationDto[]>('/reservations/mine'),
  cancel: (id: string) => request<void>(`/reservations/${id}`, { method: 'DELETE' }),
  // M4 (issue #7): live availability over SSE. `onChange` fires on every
  // pushed event *and* on every (re)connect — EventSource's own `open`
  // event covers "on reconnect the client refetches" for free, since a
  // reconnect after a drop is indistinguishable from the initial connect.
  subscribeAvailability: (cafeId: string, onChange: () => void): (() => void) => {
    const source = new EventSource(`/api/cafes/${cafeId}/availability/stream`);
    source.addEventListener('message', onChange);
    source.addEventListener('open', onChange);
    return () => source.close();
  },
  ownerListCafes: () => request<CafeDto[]>('/owner/cafes'),
  ownerCreateCafe: (name: string, area: string, description?: string) =>
    request<CafeDto>('/owner/cafes', { method: 'POST', body: JSON.stringify({ name, area, description }) }),
  ownerListTables: (cafeId: string) => request<OwnerTableDto[]>(`/owner/cafes/${cafeId}/tables`),
  ownerCreateTable: (cafeId: string, label: string, capacity: number) =>
    request<OwnerTableDto>(`/owner/cafes/${cafeId}/tables`, {
      method: 'POST',
      body: JSON.stringify({ label, capacity }),
    }),
  ownerUpdateTable: (
    cafeId: string,
    tableId: string,
    dto: Partial<{ label: string; capacity: number; inService: boolean }>,
  ) =>
    request<OwnerTableDto>(`/owner/cafes/${cafeId}/tables/${tableId}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  ownerGenerateSlots: (
    cafeId: string,
    dto: { startDate: string; days?: number; openHour?: number; closeHour?: number; turnTimeMinutes?: number },
  ) =>
    request<{ id: string }[]>(`/owner/cafes/${cafeId}/slots/generate`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  ownerBookingsForDay: (cafeId: string, date: string) =>
    request<OwnerBookingDto[]>(`/owner/cafes/${cafeId}/bookings?date=${date}`),
  startAgentWorkflow: (message: string) =>
    request<{ id: string; status: string }>('/agent/workflows', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  getAgentWorkflow: (id: string) => request<AgentWorkflowDto>(`/agent/workflows/${id}`),
  approveAgentWorkflow: (id: string) =>
    request<{ id: string; status: string }>(`/agent/workflows/${id}/approve`, { method: 'POST' }),
  answerAgentWorkflow: (id: string, answer: string) =>
    request<{ id: string; status: string }>(`/agent/workflows/${id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),
  // `EventSource` can't set an Authorization header, so the workflow's owner
  // token travels as a query param instead — the server verifies it itself
  // (see AgentController.stream) rather than relying on the header-only guard
  // every other authenticated route uses.
  subscribeAgentWorkflow: (id: string, onChange: () => void): (() => void) => {
    const token = getToken() ?? '';
    const source = new EventSource(`/api/agent/workflows/${id}/stream?token=${encodeURIComponent(token)}`);
    source.addEventListener('message', onChange);
    source.addEventListener('open', onChange);
    return () => source.close();
  },
};
