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

export const api = {
  signup: (email: string, password: string) =>
    request<AuthResponse>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  listCafes: () => request<CafeDto[]>('/cafes'),
  getAvailability: (cafeId: string, date: string) =>
    request<TableAvailabilityDto[]>(`/cafes/${cafeId}/availability?date=${date}`),
  hold: (tableId: string, slotId: string) =>
    request<HoldDto>('/reservations/hold', { method: 'POST', body: JSON.stringify({ tableId, slotId }) }),
  confirmHold: (holdId: string, tableId: string, slotId: string) =>
    request<ReservationDto>('/reservations/confirm', {
      method: 'POST',
      body: JSON.stringify({ holdId, tableId, slotId }),
    }),
  myReservations: () => request<ReservationDto[]>('/reservations/mine'),
  cancel: (id: string) => request<void>(`/reservations/${id}`, { method: 'DELETE' }),
};
