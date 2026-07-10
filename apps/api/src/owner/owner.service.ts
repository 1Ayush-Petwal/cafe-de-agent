import { randomBytes, createHash } from 'crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { CafeTable } from '../entities/cafe-table.entity';
import { Cafe } from '../entities/cafe.entity';
import { PartnerApiKey } from '../entities/partner-api-key.entity';
import { ReservationStatus } from '../entities/reservation-status.enum';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { WebhookEndpoint } from '../entities/webhook-endpoint.entity';
import {
  OPENING_HOUR_UTC,
  CLOSING_HOUR_UTC,
  TURN_TIME_MINUTES,
  dailySlotTimesConfigurable,
  toDateOnly,
} from '../seed/slot-grid';
import { AvailabilityCacheService } from '../cache/availability-cache.service';
import { CreateCafeDto } from './dto/create-cafe.dto';
import { CreateTableDto } from './dto/create-table.dto';
import { GenerateSlotsDto } from './dto/generate-slots.dto';
import { RegisterWebhookDto } from './dto/register-webhook.dto';
import { UpdateCafeDto } from './dto/update-cafe.dto';
import { UpdateTableDto } from './dto/update-table.dto';

const API_KEY_PREFIX = 'pk_';
const API_KEY_BYTES = 24;
const API_KEY_PREFIX_LENGTH = 12;

export interface GeneratedPartnerApiKey {
  id: string;
  apiKey: string;
  keyPrefix: string;
  createdAt: Date;
}

/** `keyHash` deliberately never leaves the service — there's no ClassSerializerInterceptor in this app to strip it from a raw entity response. */
export interface PartnerApiKeySummary {
  id: string;
  cafeId: string;
  keyPrefix: string;
  revokedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class OwnerService {
  constructor(
    @InjectRepository(Cafe) private readonly cafes: Repository<Cafe>,
    @InjectRepository(CafeTable) private readonly tables: Repository<CafeTable>,
    @InjectRepository(Slot) private readonly slots: Repository<Slot>,
    @InjectRepository(Reservation) private readonly reservations: Repository<Reservation>,
    @InjectRepository(PartnerApiKey) private readonly partnerApiKeys: Repository<PartnerApiKey>,
    @InjectRepository(WebhookEndpoint) private readonly webhookEndpoints: Repository<WebhookEndpoint>,
    private readonly cache: AvailabilityCacheService,
  ) {}

  async createCafe(ownerId: string, dto: CreateCafeDto): Promise<Cafe> {
    const cafe = await this.cafes.save(
      this.cafes.create({
        name: dto.name,
        area: dto.area,
        description: dto.description ?? '',
        cuisines: dto.cuisines ?? [],
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        ...(dto.openingHour !== undefined ? { openingHour: dto.openingHour } : {}),
        ...(dto.closingHour !== undefined ? { closingHour: dto.closingHour } : {}),
        ownerId,
      }),
    );
    // A new café changes the public list; drop the cache-aside list key
    // rather than waiting out its TTL (issue #18).
    await this.cache.invalidateCafeList();
    return cafe;
  }

  /** Set owner-editable locator fields — primarily cuisines (issue #18). */
  async updateCafe(ownerId: string, cafeId: string, dto: UpdateCafeDto): Promise<Cafe> {
    const cafe = await this.requireOwnedCafe(ownerId, cafeId);
    if (dto.cuisines !== undefined) cafe.cuisines = dto.cuisines;
    if (dto.latitude !== undefined) cafe.latitude = dto.latitude;
    if (dto.longitude !== undefined) cafe.longitude = dto.longitude;
    if (dto.openingHour !== undefined) cafe.openingHour = dto.openingHour;
    if (dto.closingHour !== undefined) cafe.closingHour = dto.closingHour;
    const saved = await this.cafes.save(cafe);
    await this.cache.invalidateCafeList();
    return saved;
  }

  listMyCafes(ownerId: string): Promise<Cafe[]> {
    return this.cafes.find({ where: { ownerId }, order: { name: 'ASC' } });
  }

  /** Throws NotFound if the café doesn't exist, Forbidden if it isn't owned by this owner. */
  async requireOwnedCafe(ownerId: string, cafeId: string): Promise<Cafe> {
    const cafe = await this.cafes.findOne({ where: { id: cafeId } });
    if (!cafe) {
      throw new NotFoundException('Cafe not found');
    }
    if (cafe.ownerId !== ownerId) {
      throw new ForbiddenException("Not your cafe");
    }
    return cafe;
  }

  async createTable(ownerId: string, cafeId: string, dto: CreateTableDto): Promise<CafeTable> {
    await this.requireOwnedCafe(ownerId, cafeId);
    return this.tables.save(
      this.tables.create({ cafeId, label: dto.label, capacity: dto.capacity }),
    );
  }

  async listTables(ownerId: string, cafeId: string): Promise<CafeTable[]> {
    await this.requireOwnedCafe(ownerId, cafeId);
    return this.tables.find({ where: { cafeId }, order: { label: 'ASC' } });
  }

  async updateTable(
    ownerId: string,
    cafeId: string,
    tableId: string,
    dto: UpdateTableDto,
  ): Promise<CafeTable> {
    await this.requireOwnedCafe(ownerId, cafeId);
    const table = await this.tables.findOne({ where: { id: tableId, cafeId } });
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    Object.assign(table, dto);
    return this.tables.save(table);
  }

  /** Generates (or extends) the daily slot grid for this café; skips dates that already have slots. */
  async generateSlots(ownerId: string, cafeId: string, dto: GenerateSlotsDto): Promise<Slot[]> {
    await this.requireOwnedCafe(ownerId, cafeId);
    const days = dto.days ?? 14;
    const openHour = dto.openHour ?? OPENING_HOUR_UTC;
    const closeHour = dto.closeHour ?? CLOSING_HOUR_UTC;
    const turnTimeMinutes = dto.turnTimeMinutes ?? TURN_TIME_MINUTES;
    if (closeHour <= openHour) {
      throw new ForbiddenException('closeHour must be after openHour');
    }

    const start = new Date(`${dto.startDate}T00:00:00.000Z`);
    const dateStrings = Array.from({ length: days }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      return toDateOnly(d);
    });

    const candidateTimes = dateStrings.flatMap((dateOnly) =>
      dailySlotTimesConfigurable(dateOnly, openHour, closeHour, turnTimeMinutes),
    );
    if (candidateTimes.length === 0) {
      return [];
    }

    const existing = await this.slots.find({
      where: {
        cafeId,
        slotTime: Between(candidateTimes[0], candidateTimes[candidateTimes.length - 1]),
      },
    });
    const existingTimes = new Set(existing.map((s) => s.slotTime.getTime()));
    const toCreate = candidateTimes.filter((t) => !existingTimes.has(t.getTime()));
    if (toCreate.length === 0) {
      return [];
    }
    return this.slots.save(toCreate.map((slotTime) => this.slots.create({ cafeId, slotTime })));
  }

  async bookingsForDay(ownerId: string, cafeId: string, date: string): Promise<Reservation[]> {
    await this.requireOwnedCafe(ownerId, cafeId);
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    const daySlots = await this.slots.find({
      where: { cafeId, slotTime: Between(dayStart, dayEnd) },
    });
    if (daySlots.length === 0) {
      return [];
    }
    return this.reservations.find({
      where: {
        slotId: In(daySlots.map((s) => s.id)),
        status: ReservationStatus.BOOKED,
      },
      relations: ['table', 'slot', 'user'],
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Issue #24 (PRD area G): the raw key is returned exactly once, here, and
   * never again — only its SHA-256 hash is persisted (`ApiKeyGuard` hashes
   * an incoming key the same way and looks up by hash). `keyPrefix` is kept
   * in the clear purely so the dashboard's key list stays identifiable
   * after this response is gone.
   */
  async generatePartnerApiKey(ownerId: string, cafeId: string): Promise<GeneratedPartnerApiKey> {
    await this.requireOwnedCafe(ownerId, cafeId);
    const apiKey = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('hex')}`;
    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const keyPrefix = apiKey.slice(0, API_KEY_PREFIX_LENGTH);
    const saved = await this.partnerApiKeys.save(
      this.partnerApiKeys.create({ cafeId, keyHash, keyPrefix, revokedAt: null }),
    );
    return { id: saved.id, apiKey, keyPrefix, createdAt: saved.createdAt };
  }

  async listPartnerApiKeys(ownerId: string, cafeId: string): Promise<PartnerApiKeySummary[]> {
    await this.requireOwnedCafe(ownerId, cafeId);
    const keys = await this.partnerApiKeys.find({ where: { cafeId }, order: { createdAt: 'DESC' } });
    return keys.map((key) => ({
      id: key.id,
      cafeId: key.cafeId,
      keyPrefix: key.keyPrefix,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
    }));
  }

  /** Idempotent: revoking an already-revoked key is a no-op rather than bumping revokedAt again. */
  async revokePartnerApiKey(ownerId: string, cafeId: string, keyId: string): Promise<void> {
    await this.requireOwnedCafe(ownerId, cafeId);
    const key = await this.partnerApiKeys.findOne({ where: { id: keyId, cafeId } });
    if (!key) {
      throw new NotFoundException('API key not found');
    }
    if (!key.revokedAt) {
      await this.partnerApiKeys.update({ id: key.id }, { revokedAt: new Date() });
    }
  }

  /** One endpoint per café — re-registering replaces the URL rather than accumulating rows. */
  async registerWebhookEndpoint(ownerId: string, cafeId: string, dto: RegisterWebhookDto): Promise<WebhookEndpoint> {
    await this.requireOwnedCafe(ownerId, cafeId);
    const existing = await this.webhookEndpoints.findOne({ where: { cafeId } });
    if (existing) {
      existing.url = dto.url;
      return this.webhookEndpoints.save(existing);
    }
    return this.webhookEndpoints.save(this.webhookEndpoints.create({ cafeId, url: dto.url }));
  }

  async getWebhookEndpoint(ownerId: string, cafeId: string): Promise<WebhookEndpoint | null> {
    await this.requireOwnedCafe(ownerId, cafeId);
    return this.webhookEndpoints.findOne({ where: { cafeId } });
  }
}
