import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const SANDRA_CATALOG_SCHEMA_VERSION = 1 as const;
export type CatalogStatus = "verified" | "pending" | "rejected" | "stale" | "closed";

export type CatalogSource = {
  url: string;
  checkedAt: string;
  kind: "operator" | "directory" | "search" | "user_hint" | "other";
  note?: string;
};

export type Coordinates = {
  latitude: number;
  longitude: number;
  sourceUrl: string;
  checkedAt: string;
};

export type CatalogPlace = {
  id: string;
  name: string;
  normalizedName: string;
  category: string;
  normalizedCategory: string;
  address: string;
  normalizedAddress: string;
  phone?: string;
  normalizedPhone?: string;
  description?: string;
  hours?: string;
  region?: string;
  status: CatalogStatus;
  sources: CatalogSource[];
  checkedAt: string;
  staleAt: string;
  coordinates?: Coordinates;
  createdAt: string;
  updatedAt: string;
};

export type ReviewItem = {
  id: string;
  placeId: string;
  reason: string;
  createdAt: string;
  resolvedAt?: string;
};

export type CatalogAuditEvent = {
  id: string;
  at: string;
  action: "created" | "updated" | "status_changed" | "review_queued";
  placeId: string;
  changedFields: string[];
};

export type SandraCatalogData = {
  schemaVersion: typeof SANDRA_CATALOG_SCHEMA_VERSION;
  places: CatalogPlace[];
  reviewQueue: ReviewItem[];
  auditLog: CatalogAuditEvent[];
};

export type PlaceInput = {
  name: string;
  category: string;
  address: string;
  phone?: string;
  description?: string;
  hours?: string;
  region?: string;
  status?: CatalogStatus;
  sources?: CatalogSource[];
  checkedAt?: string;
  staleAt?: string;
  coordinates?: Coordinates;
};

export type UpsertResult = {
  place: CatalogPlace;
  action: "created" | "updated";
  reviewItem?: ReviewItem;
};

const processQueues = new Map<string, Promise<void>>();
const MAX_AUDIT_EVENTS = 1_000;
const DEFAULT_STALE_AFTER_DAYS = 90;
const categoryAliases: Record<string, string> = {
  apotheke: "pharmacy",
  pharmacy: "pharmacy",
  drugstore: "pharmacy",
  restaurant: "restaurant",
  thairestaurant: "restaurant",
  cafe: "cafe",
  café: "cafe",
  zahnarzt: "dentist",
  dentist: "dentist",
  dentalclinic: "dentist",
  handyreparatur: "phone repair",
  mobiltelefonreparatur: "phone repair",
  phonerepair: "phone repair",
  tierarzt: "veterinarian",
  veterinarian: "veterinarian",
  arzt: "doctor",
  doctor: "doctor",
  klinik: "clinic",
  clinic: "clinic",
};
const QUERY_STOP_WORDS = new Set([
  "wo", "wie", "was", "wer", "finde", "finden", "suche", "suchen", "such",
  "ich", "mir", "eine", "einen", "einer", "ein", "der", "die", "das", "in",
  "im", "am", "auf", "bei", "bitte", "gibt", "es", "zeig", "zeige", "kennst",
  "empfiehl", "brauche", "benotige", "pattaya", "naklua", "wongamat",
  "central", "pratumnak", "jomtien", "jomtian", "darkside", "east",
]);

/** Locale-independent matching key that also joins common Thai/English spelling variants. */
export function normalizeCatalogText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/gu, "ss")
    // Apostrophes occur inside names (Müller's/Mullers), not between words.
    .replace(/['’`]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function normalizeCategory(value: string): string {
  const key = normalizeCatalogText(value).replace(/\s/gu, "");
  return categoryAliases[key] ?? normalizeCatalogText(value);
}

function normalizePhone(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/gu, "");
  return digits && digits.length >= 6 ? digits : undefined;
}

function isoNow(): string {
  return new Date().toISOString();
}

function futureStaleAt(checkedAt: string, days: number): string {
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) throw new Error("checkedAt must be an ISO date.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validateSource(source: CatalogSource): void {
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:") throw new Error();
  } catch {
    throw new Error("Sources require a valid HTTPS URL.");
  }
  if (Number.isNaN(new Date(source.checkedAt).getTime())) {
    throw new Error("Source checkedAt must be an ISO date.");
  }
}

function validateInput(input: PlaceInput): void {
  if (!normalizeCatalogText(input.name) || !normalizeCatalogText(input.address)) {
    throw new Error("A place requires a name and address.");
  }
  if (!normalizeCategory(input.category)) throw new Error("A place requires a category.");
  for (const source of input.sources ?? []) validateSource(source);
  const coordinates = input.coordinates;
  if (
    coordinates &&
    (!Number.isFinite(coordinates.latitude) ||
      !Number.isFinite(coordinates.longitude) ||
      coordinates.latitude < -90 ||
      coordinates.latitude > 90 ||
      coordinates.longitude < -180 ||
      coordinates.longitude > 180)
  ) {
    throw new Error("Coordinates must be valid latitude and longitude values.");
  }
  if (coordinates) validateSource({ url: coordinates.sourceUrl, checkedAt: coordinates.checkedAt, kind: "other" });
}

function emptyCatalog(): SandraCatalogData {
  return { schemaVersion: SANDRA_CATALOG_SCHEMA_VERSION, places: [], reviewQueue: [], auditLog: [] };
}

function parseCatalog(raw: string): SandraCatalogData {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Catalog root must be an object.");
  }
  const data = parsed as Partial<SandraCatalogData>;
  if (data.schemaVersion !== SANDRA_CATALOG_SCHEMA_VERSION) {
    throw new Error(`Unsupported Sandra catalog schema version: ${String(data.schemaVersion)}.`);
  }
  if (
    !Array.isArray(data.places) ||
    !Array.isArray(data.reviewQueue) ||
    !Array.isArray(data.auditLog)
  ) {
    throw new Error("Invalid Sandra catalog schema.");
  }
  return data as SandraCatalogData;
}

function similarName(left: string, right: string): boolean {
  if (left === right) return true;
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  const common = [...a].filter((word) => b.has(word)).length;
  return common >= 2 && common / Math.max(a.size, b.size) >= 0.6;
}

function findDuplicate(places: CatalogPlace[], input: PlaceInput): CatalogPlace | undefined {
  const name = normalizeCatalogText(input.name);
  const address = normalizeCatalogText(input.address);
  const phone = normalizePhone(input.phone);
  return places.find((place) => {
    const sameLocation =
      place.normalizedAddress === address ||
      (phone !== undefined && place.normalizedPhone === phone);
    // Same name alone is intentionally insufficient: branches remain distinct.
    return sameLocation && similarName(place.normalizedName, name);
  });
}

function mergeSources(existing: CatalogSource[], incoming: CatalogSource[]): CatalogSource[] {
  const result = [...existing];
  for (const source of incoming) {
    if (!result.some((value) => value.url === source.url && value.checkedAt === source.checkedAt)) {
      result.push(source);
    }
  }
  return result;
}

export class SandraCatalog {
  private readonly lockPath: string;
  private readonly backupDir: string;

  constructor(
    readonly filePath: string,
    private readonly options: {
      maxBackups?: number;
      staleAfterDays?: number;
      lockWaitMs?: number;
    } = {},
  ) {
    this.lockPath = `${filePath}.lock`;
    this.backupDir = `${filePath}.backups`;
  }

  async read(): Promise<SandraCatalogData> {
    try {
      return parseCatalog(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyCatalog();
      try {
        const backups = (await readdir(this.backupDir))
          .filter((name) => name.endsWith(".json"))
          .sort()
          .reverse();
        for (const backup of backups) {
          try {
            return parseCatalog(
              await readFile(path.join(this.backupDir, backup), "utf8"),
            );
          } catch {
            // Continue with the next older backup.
          }
        }
      } catch {
        // The original validation error below is more useful.
      }
      throw error;
    }
  }

  async upsert(input: PlaceInput): Promise<UpsertResult> {
    validateInput(input);
    return this.mutate((data) => {
      const now = isoNow();
      const checkedAt = input.checkedAt ?? now;
      const staleAt = input.staleAt ?? futureStaleAt(checkedAt, this.options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS);
      const duplicate = findDuplicate(data.places, input);
      let place: CatalogPlace;
      let action: UpsertResult["action"];
      let reviewReason: string | undefined;
      if (duplicate) {
        action = "updated";
        const oldStatus = duplicate.status;
        const conflictingFields = [
          duplicate.name !== input.name.trim() ? "name" : "",
          duplicate.address !== input.address.trim() ? "address" : "",
          normalizeCategory(input.category) !== duplicate.normalizedCategory
            ? "category"
            : "",
          input.region !== undefined &&
          normalizeCatalogText(input.region) !==
            normalizeCatalogText(duplicate.region ?? "")
            ? "region"
            : "",
          input.phone !== undefined &&
          duplicate.phone !== undefined &&
          normalizePhone(input.phone) !== duplicate.normalizedPhone
            ? "phone"
            : "",
          input.hours !== undefined &&
          duplicate.hours !== undefined &&
          normalizeCatalogText(input.hours) !== normalizeCatalogText(duplicate.hours)
            ? "hours"
            : "",
          input.coordinates !== undefined &&
          (duplicate.coordinates === undefined ||
            input.coordinates.latitude !== duplicate.coordinates.latitude ||
            input.coordinates.longitude !== duplicate.coordinates.longitude ||
            input.coordinates.sourceUrl !== duplicate.coordinates.sourceUrl ||
            input.coordinates.checkedAt !== duplicate.coordinates.checkedAt)
            ? "coordinates"
            : "",
        ].filter(Boolean);
        if (
          duplicate.status === "verified" &&
          input.status === "verified" &&
          conflictingFields.length > 0
        ) {
          reviewReason = `Conflicting verified fields: ${conflictingFields.join(", ")}.`;
        }
        // This supports a verified address/name correction; branch matching happened first.
        place = {
          ...duplicate,
          ...input,
          normalizedName: normalizeCatalogText(input.name),
          normalizedCategory: normalizeCategory(input.category),
          normalizedAddress: normalizeCatalogText(input.address),
          phone: input.phone === undefined ? duplicate.phone : input.phone.trim() || undefined,
          normalizedPhone: input.phone === undefined ? duplicate.normalizedPhone : normalizePhone(input.phone),
          description: input.description === undefined ? duplicate.description : input.description.trim() || undefined,
          hours: input.hours === undefined ? duplicate.hours : input.hours.trim() || undefined,
          region: input.region === undefined ? duplicate.region : input.region.trim() || undefined,
          status:
            duplicate.status === "pending"
              ? "pending"
              : reviewReason
                ? "pending"
                : input.status ?? duplicate.status,
          coordinates: input.coordinates ?? duplicate.coordinates,
          sources: mergeSources(duplicate.sources, input.sources ?? []),
          checkedAt,
          staleAt,
          updatedAt: now,
        };
        Object.assign(duplicate, place);
        this.audit(data, oldStatus === place.status ? "updated" : "status_changed", place.id, Object.keys(input));
      } else {
        action = "created";
        place = {
          id: randomUUID(),
          name: input.name.trim(),
          normalizedName: normalizeCatalogText(input.name),
          category: input.category.trim(),
          normalizedCategory: normalizeCategory(input.category),
          address: input.address.trim(),
          normalizedAddress: normalizeCatalogText(input.address),
          phone: input.phone?.trim() || undefined,
          normalizedPhone: normalizePhone(input.phone),
          description: input.description?.trim() || undefined,
          hours: input.hours?.trim() || undefined,
          region: input.region?.trim() || undefined,
          status: input.status ?? "pending",
          sources: input.sources ?? [],
          checkedAt,
          staleAt,
          coordinates: input.coordinates,
          createdAt: now,
          updatedAt: now,
        };
        data.places.push(place);
        this.audit(data, "created", place.id, [
          "name",
          "category",
          "address",
          "status",
          ...("description" in input ? ["description"] : []),
          ...("hours" in input ? ["hours"] : []),
        ]);
      }
      const reviewItem = place.status === "pending" || place.status === "stale"
        ? this.queueReview(
            data,
            place.id,
            reviewReason ??
              (place.status === "stale"
                ? "Entry needs fresh verification."
                : "New entry requires verification."),
          )
        : undefined;
      return { place: clone(place), action, reviewItem: reviewItem && clone(reviewItem) };
    });
  }

  async markStale(now = isoNow()): Promise<number> {
    return this.mutate((data) => {
      let changed = 0;
      for (const place of data.places) {
        if (place.status === "verified" && place.staleAt <= now) {
          place.status = "stale";
          place.updatedAt = now;
          changed += 1;
          this.audit(data, "status_changed", place.id, ["status"]);
          this.queueReview(data, place.id, "Entry needs fresh verification.");
        }
      }
      return changed;
    });
  }

  /** Returns only verified, current entries from exactly the requested region. */
  async searchVerified({
    region,
    query,
    limit = 10,
  }: {
    region: string;
    query: string;
    limit?: number;
  }): Promise<CatalogPlace[]> {
    const normalizedRegion = normalizeCatalogText(region);
    const normalizedQuery = normalizeCatalogText(query);
    if (!normalizedRegion || !normalizedQuery) return [];
    const tokens = normalizedQuery
      .split(" ")
      .filter((token) => token.length >= 3 && !QUERY_STOP_WORDS.has(token));
    const requestedCategory = normalizeCategory(query);
    const maximum = Math.min(50, Math.max(1, Math.floor(limit)));
    const now = isoNow();
    const data = await this.read();
    return data.places
      .filter((place) => {
        if (
          place.status !== "verified" ||
          place.staleAt <= now ||
          normalizeCatalogText(place.region ?? "") !== normalizedRegion
        ) {
          return false;
        }
        const searchable = normalizeCatalogText(
          `${place.name} ${place.category} ${place.description ?? ""} ${place.hours ?? ""}`,
        );
        if (
          /\b(?:apotheke|pharmacy|drugstore|chemist)\b/u.test(normalizedQuery) &&
          !/\b(?:cannabis|weed|ganja)\b/u.test(normalizedQuery) &&
          /\b(?:cannabis|weed|ganja|dispensary)\b/u.test(searchable)
        ) {
          return false;
        }
        const matchedTokens = tokens.filter((token) => searchable.includes(token));
        return (
          place.normalizedName.includes(normalizedQuery) ||
          place.normalizedCategory.includes(requestedCategory) ||
          (tokens.length > 0 && matchedTokens.length > 0)
        );
      })
      .slice(0, maximum)
      .map(clone);
  }

  async findById(placeId: string): Promise<CatalogPlace | undefined> {
    const place = (await this.read()).places.find((candidate) => candidate.id === placeId);
    return place ? clone(place) : undefined;
  }

  /** Immediately removes a questioned entry from publication until reviewed. */
  async queueUserHint(placeId: string, reason: string): Promise<ReviewItem> {
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new Error("A user hint requires a reason.");
    return this.mutate((data) => {
      const place = data.places.find((candidate) => candidate.id === placeId);
      if (!place) {
        throw new Error(`Unknown Sandra catalog place: ${placeId}`);
      }
      if (place.status === "verified") {
        place.status = "pending";
        place.updatedAt = isoNow();
        this.audit(data, "status_changed", placeId, ["status"]);
      }
      return clone(this.queueReview(data, placeId, `User hint: ${trimmedReason}`, false));
    });
  }

  private queueReview(data: SandraCatalogData, placeId: string, reason: string, deduplicate = true): ReviewItem {
    const active = deduplicate
      ? data.reviewQueue.find((item) => item.placeId === placeId && !item.resolvedAt)
      : undefined;
    if (active) return active;
    const item: ReviewItem = { id: randomUUID(), placeId, reason, createdAt: isoNow() };
    data.reviewQueue.push(item);
    this.audit(data, "review_queued", placeId, ["reviewQueue"]);
    return item;
  }

  private audit(data: SandraCatalogData, action: CatalogAuditEvent["action"], placeId: string, changedFields: string[]): void {
    // Deliberately records field names, never submitted values (which may contain secrets).
    data.auditLog.push({ id: randomUUID(), at: isoNow(), action, placeId, changedFields });
    if (data.auditLog.length > MAX_AUDIT_EVENTS) data.auditLog.splice(0, data.auditLog.length - MAX_AUDIT_EVENTS);
  }

  private async mutate<T>(operation: (data: SandraCatalogData) => T): Promise<T> {
    const previous = processQueues.get(this.filePath) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    processQueues.set(this.filePath, tail);
    await previous;
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const lock = await this.acquireLock();
      try {
        const data = await this.read();
        const result = operation(data);
        await this.backupIfPresent();
        await this.atomicWrite(data);
        return result;
      } finally {
        await lock.handle.close();
        try {
          if ((await readFile(this.lockPath, "utf8")) === lock.owner) {
            await rm(this.lockPath, { force: true });
          }
        } catch {
          // Another process may already have replaced or removed an expired lock.
        }
      }
    } finally {
      release();
      if (processQueues.get(this.filePath) === tail) processQueues.delete(this.filePath);
    }
  }

  private async acquireLock() {
    const timeout = this.options.lockWaitMs ?? 5_000;
    const deadline = Date.now() + timeout;
    for (;;) {
      try {
        const handle = await open(this.lockPath, "wx");
        const owner = `${process.pid}:${randomUUID()}`;
        await handle.writeFile(owner, "utf8");
        return { handle, owner };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          // Never steal a lock: safety is more important than automatic recovery.
        }
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) {
          throw new Error(`Sandra catalog is locked: ${this.filePath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  private async backupIfPresent(): Promise<void> {
    try {
      await stat(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await mkdir(this.backupDir, { recursive: true });
    await copyFile(this.filePath, path.join(this.backupDir, `${Date.now()}-${randomUUID()}.json`));
    const backups = (await readdir(this.backupDir))
      .filter((name) => name.endsWith(".json"))
      .sort();
    const excess = backups.length - (this.options.maxBackups ?? 10);
    await Promise.all(backups.slice(0, Math.max(0, excess)).map((name) => rm(path.join(this.backupDir, name))));
  }

  private async atomicWrite(data: SandraCatalogData): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filePath);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}