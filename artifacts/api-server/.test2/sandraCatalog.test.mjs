// artifacts/api-server/src/lib/sandraCatalog.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile as readFile2, readdir as readdir2, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";
import path2 from "node:path";
import { tmpdir } from "node:os";

// artifacts/api-server/src/lib/sandraCatalog.ts
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
  writeFile
} from "node:fs/promises";
import path from "node:path";
var SANDRA_CATALOG_SCHEMA_VERSION = 1;
var processQueues = /* @__PURE__ */ new Map();
var MAX_AUDIT_EVENTS = 1e3;
var DEFAULT_STALE_AFTER_DAYS = 90;
var categoryAliases = {
  apotheke: "pharmacy",
  pharmacy: "pharmacy",
  drugstore: "pharmacy",
  restaurant: "restaurant",
  thairestaurant: "restaurant",
  cafe: "cafe",
  caf\u00E9: "cafe",
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
  clinic: "clinic"
};
var QUERY_STOP_WORDS = /* @__PURE__ */ new Set([
  "wo",
  "wie",
  "was",
  "wer",
  "finde",
  "finden",
  "suche",
  "suchen",
  "such",
  "ich",
  "mir",
  "eine",
  "einen",
  "einer",
  "ein",
  "der",
  "die",
  "das",
  "in",
  "im",
  "am",
  "auf",
  "bei",
  "bitte",
  "gibt",
  "es",
  "zeig",
  "zeige",
  "kennst",
  "empfiehl",
  "brauche",
  "benotige",
  "pattaya",
  "naklua",
  "wongamat",
  "central",
  "pratumnak",
  "jomtien",
  "jomtian",
  "darkside",
  "east"
]);
function normalizeCatalogText(value) {
  return value.trim().toLocaleLowerCase("en-US").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/ß/gu, "ss").replace(/['’`]/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}
function normalizeCategory(value) {
  const key = normalizeCatalogText(value).replace(/\s/gu, "");
  return categoryAliases[key] ?? normalizeCatalogText(value);
}
function normalizePhone(value) {
  const digits = value?.replace(/\D/gu, "");
  return digits && digits.length >= 6 ? digits : void 0;
}
function isoNow() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function futureStaleAt(checkedAt, days) {
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) throw new Error("checkedAt must be an ISO date.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function validateSource(source) {
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
function validateInput(input) {
  if (!normalizeCatalogText(input.name) || !normalizeCatalogText(input.address)) {
    throw new Error("A place requires a name and address.");
  }
  if (!normalizeCategory(input.category)) throw new Error("A place requires a category.");
  for (const source of input.sources ?? []) validateSource(source);
  const coordinates = input.coordinates;
  if (coordinates && (!Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude) || coordinates.latitude < -90 || coordinates.latitude > 90 || coordinates.longitude < -180 || coordinates.longitude > 180)) {
    throw new Error("Coordinates must be valid latitude and longitude values.");
  }
  if (coordinates) validateSource({ url: coordinates.sourceUrl, checkedAt: coordinates.checkedAt, kind: "other" });
}
function emptyCatalog() {
  return { schemaVersion: SANDRA_CATALOG_SCHEMA_VERSION, places: [], reviewQueue: [], auditLog: [] };
}
function parseCatalog(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Catalog root must be an object.");
  }
  const data = parsed;
  if (data.schemaVersion !== SANDRA_CATALOG_SCHEMA_VERSION) {
    throw new Error(`Unsupported Sandra catalog schema version: ${String(data.schemaVersion)}.`);
  }
  if (!Array.isArray(data.places) || !Array.isArray(data.reviewQueue) || !Array.isArray(data.auditLog)) {
    throw new Error("Invalid Sandra catalog schema.");
  }
  return data;
}
function similarName(left, right) {
  if (left === right) return true;
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  const common = [...a].filter((word) => b.has(word)).length;
  return common >= 2 && common / Math.max(a.size, b.size) >= 0.6;
}
function findDuplicate(places, input) {
  const name = normalizeCatalogText(input.name);
  const address = normalizeCatalogText(input.address);
  const phone = normalizePhone(input.phone);
  return places.find((place) => {
    const sameLocation = place.normalizedAddress === address || phone !== void 0 && place.normalizedPhone === phone;
    return sameLocation && similarName(place.normalizedName, name);
  });
}
function mergeSources(existing, incoming) {
  const result = [...existing];
  for (const source of incoming) {
    if (!result.some((value) => value.url === source.url && value.checkedAt === source.checkedAt)) {
      result.push(source);
    }
  }
  return result;
}
var SandraCatalog = class {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.options = options;
    this.lockPath = `${filePath}.lock`;
    this.backupDir = `${filePath}.backups`;
  }
  lockPath;
  backupDir;
  async read() {
    try {
      return parseCatalog(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return emptyCatalog();
      try {
        const backups = (await readdir(this.backupDir)).filter((name) => name.endsWith(".json")).sort().reverse();
        for (const backup of backups) {
          try {
            return parseCatalog(
              await readFile(path.join(this.backupDir, backup), "utf8")
            );
          } catch {
          }
        }
      } catch {
      }
      throw error;
    }
  }
  async upsert(input) {
    validateInput(input);
    return this.mutate((data) => {
      const now = isoNow();
      const checkedAt = input.checkedAt ?? now;
      const staleAt = input.staleAt ?? futureStaleAt(checkedAt, this.options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS);
      const duplicate = findDuplicate(data.places, input);
      let place;
      let action;
      let reviewReason;
      if (duplicate) {
        action = "updated";
        const oldStatus = duplicate.status;
        const conflictingFields = [
          duplicate.name !== input.name.trim() ? "name" : "",
          duplicate.address !== input.address.trim() ? "address" : "",
          normalizeCategory(input.category) !== duplicate.normalizedCategory ? "category" : "",
          input.region !== void 0 && normalizeCatalogText(input.region) !== normalizeCatalogText(duplicate.region ?? "") ? "region" : "",
          input.phone !== void 0 && duplicate.phone !== void 0 && normalizePhone(input.phone) !== duplicate.normalizedPhone ? "phone" : "",
          input.hours !== void 0 && duplicate.hours !== void 0 && normalizeCatalogText(input.hours) !== normalizeCatalogText(duplicate.hours) ? "hours" : "",
          input.coordinates !== void 0 && (duplicate.coordinates === void 0 || input.coordinates.latitude !== duplicate.coordinates.latitude || input.coordinates.longitude !== duplicate.coordinates.longitude || input.coordinates.sourceUrl !== duplicate.coordinates.sourceUrl || input.coordinates.checkedAt !== duplicate.coordinates.checkedAt) ? "coordinates" : ""
        ].filter(Boolean);
        if (duplicate.status === "verified" && input.status === "verified" && conflictingFields.length > 0) {
          reviewReason = `Conflicting verified fields: ${conflictingFields.join(", ")}.`;
        }
        place = {
          ...duplicate,
          ...input,
          normalizedName: normalizeCatalogText(input.name),
          normalizedCategory: normalizeCategory(input.category),
          normalizedAddress: normalizeCatalogText(input.address),
          phone: input.phone === void 0 ? duplicate.phone : input.phone.trim() || void 0,
          normalizedPhone: input.phone === void 0 ? duplicate.normalizedPhone : normalizePhone(input.phone),
          description: input.description === void 0 ? duplicate.description : input.description.trim() || void 0,
          hours: input.hours === void 0 ? duplicate.hours : input.hours.trim() || void 0,
          region: input.region === void 0 ? duplicate.region : input.region.trim() || void 0,
          status: duplicate.status === "pending" ? "pending" : reviewReason ? "pending" : input.status ?? duplicate.status,
          coordinates: input.coordinates ?? duplicate.coordinates,
          sources: mergeSources(duplicate.sources, input.sources ?? []),
          checkedAt,
          staleAt,
          updatedAt: now
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
          phone: input.phone?.trim() || void 0,
          normalizedPhone: normalizePhone(input.phone),
          description: input.description?.trim() || void 0,
          hours: input.hours?.trim() || void 0,
          region: input.region?.trim() || void 0,
          status: input.status ?? "pending",
          sources: input.sources ?? [],
          checkedAt,
          staleAt,
          coordinates: input.coordinates,
          createdAt: now,
          updatedAt: now
        };
        data.places.push(place);
        this.audit(data, "created", place.id, [
          "name",
          "category",
          "address",
          "status",
          ..."description" in input ? ["description"] : [],
          ..."hours" in input ? ["hours"] : []
        ]);
      }
      const reviewItem = place.status === "pending" || place.status === "stale" ? this.queueReview(
        data,
        place.id,
        reviewReason ?? (place.status === "stale" ? "Entry needs fresh verification." : "New entry requires verification.")
      ) : void 0;
      return { place: clone(place), action, reviewItem: reviewItem && clone(reviewItem) };
    });
  }
  async markStale(now = isoNow()) {
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
    limit = 10
  }) {
    const normalizedRegion = normalizeCatalogText(region);
    const normalizedQuery = normalizeCatalogText(query);
    if (!normalizedRegion || !normalizedQuery) return [];
    const tokens = normalizedQuery.split(" ").filter((token) => token.length >= 3 && !QUERY_STOP_WORDS.has(token));
    const requestedCategory = normalizeCategory(query);
    const maximum = Math.min(50, Math.max(1, Math.floor(limit)));
    const now = isoNow();
    const data = await this.read();
    return data.places.filter((place) => {
      if (place.status !== "verified" || place.staleAt <= now || normalizeCatalogText(place.region ?? "") !== normalizedRegion) {
        return false;
      }
      const searchable = normalizeCatalogText(
        `${place.name} ${place.category} ${place.description ?? ""} ${place.hours ?? ""}`
      );
      if (/\b(?:apotheke|pharmacy|drugstore|chemist)\b/u.test(normalizedQuery) && !/\b(?:cannabis|weed|ganja)\b/u.test(normalizedQuery) && /\b(?:cannabis|weed|ganja|dispensary)\b/u.test(searchable)) {
        return false;
      }
      const matchedTokens = tokens.filter((token) => searchable.includes(token));
      return place.normalizedName.includes(normalizedQuery) || place.normalizedCategory.includes(requestedCategory) || tokens.length > 0 && matchedTokens.length > 0;
    }).slice(0, maximum).map(clone);
  }
  async findById(placeId) {
    const place = (await this.read()).places.find((candidate) => candidate.id === placeId);
    return place ? clone(place) : void 0;
  }
  /** Immediately removes a questioned entry from publication until reviewed. */
  async queueUserHint(placeId, reason) {
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
  queueReview(data, placeId, reason, deduplicate = true) {
    const active = deduplicate ? data.reviewQueue.find((item2) => item2.placeId === placeId && !item2.resolvedAt) : void 0;
    if (active) return active;
    const item = { id: randomUUID(), placeId, reason, createdAt: isoNow() };
    data.reviewQueue.push(item);
    this.audit(data, "review_queued", placeId, ["reviewQueue"]);
    return item;
  }
  audit(data, action, placeId, changedFields) {
    data.auditLog.push({ id: randomUUID(), at: isoNow(), action, placeId, changedFields });
    if (data.auditLog.length > MAX_AUDIT_EVENTS) data.auditLog.splice(0, data.auditLog.length - MAX_AUDIT_EVENTS);
  }
  async mutate(operation) {
    const previous = processQueues.get(this.filePath) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
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
          if (await readFile(this.lockPath, "utf8") === lock.owner) {
            await rm(this.lockPath, { force: true });
          }
        } catch {
        }
      }
    } finally {
      release();
      if (processQueues.get(this.filePath) === tail) processQueues.delete(this.filePath);
    }
  }
  async acquireLock() {
    const timeout = this.options.lockWaitMs ?? 5e3;
    const deadline = Date.now() + timeout;
    for (; ; ) {
      try {
        const handle = await open(this.lockPath, "wx");
        const owner = `${process.pid}:${randomUUID()}`;
        await handle.writeFile(owner, "utf8");
        return { handle, owner };
      } catch (error) {
        if (error.code === "EEXIST") {
        }
        if (error.code !== "EEXIST" || Date.now() >= deadline) {
          throw new Error(`Sandra catalog is locked: ${this.filePath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
  async backupIfPresent() {
    try {
      await stat(this.filePath);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await mkdir(this.backupDir, { recursive: true });
    await copyFile(this.filePath, path.join(this.backupDir, `${Date.now()}-${randomUUID()}.json`));
    const backups = (await readdir(this.backupDir)).filter((name) => name.endsWith(".json")).sort();
    const excess = backups.length - (this.options.maxBackups ?? 10);
    await Promise.all(backups.slice(0, Math.max(0, excess)).map((name) => rm(path.join(this.backupDir, name))));
  }
  async atomicWrite(data) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}
`, { encoding: "utf8", mode: 384 });
      await rename(temporary, this.filePath);
    } finally {
      await rm(temporary, { force: true });
    }
  }
};

// artifacts/api-server/src/lib/sandraCatalog.test.ts
async function fixture() {
  const dir = await mkdtemp(path2.join(tmpdir(), "sandra-catalog-"));
  return { dir, catalog: new SandraCatalog(path2.join(dir, "catalog.json"), { maxBackups: 2 }) };
}
test("normalizes categories and updates a duplicate without changing its ID", async () => {
  const { catalog, dir } = await fixture();
  try {
    const first = await catalog.upsert({ name: "M\xFCller's Pharmacy", category: "Apotheke", address: "1 Beach Road", phone: "+66 1234567", status: "verified" });
    const second = await catalog.upsert({ name: "Mullers Pharmacy", category: "Drugstore", address: "1 Beach Road", phone: "+66 1234567", status: "verified" });
    assert.equal(second.action, "updated");
    assert.equal(second.place.id, first.place.id);
    assert.equal(normalizeCategory("Apotheke"), "pharmacy");
  } finally {
    await rm2(dir, { recursive: true, force: true });
  }
});
test("keeps branches with matching names at distinct addresses", async () => {
  const { catalog, dir } = await fixture();
  try {
    const one = await catalog.upsert({ name: "Good Cafe", category: "cafe", address: "1 Road", status: "pending" });
    const two = await catalog.upsert({ name: "Good Cafe", category: "cafe", address: "2 Road", status: "pending" });
    assert.notEqual(one.place.id, two.place.id);
    assert.equal((await catalog.read()).reviewQueue.length, 2);
  } finally {
    await rm2(dir, { recursive: true, force: true });
  }
});
test("marks expired verified entries stale and retains bounded backups", async () => {
  const { catalog, dir } = await fixture();
  try {
    await catalog.upsert({ name: "Old Place", category: "restaurant", address: "1 Road", status: "verified", checkedAt: "2020-01-01T00:00:00.000Z", staleAt: "2020-01-02T00:00:00.000Z" });
    assert.equal(await catalog.markStale("2021-01-01T00:00:00.000Z"), 1);
    await catalog.upsert({ name: "New Place", category: "restaurant", address: "3 Road" });
    const backups = await readdir2(path2.join(dir, "catalog.json.backups"));
    assert.ok(backups.length <= 2);
    assert.equal((await catalog.read()).places[0]?.status, "stale");
  } finally {
    await rm2(dir, { recursive: true, force: true });
  }
});
test("searches only current verified entries in the exact requested region", async () => {
  const { catalog, dir } = await fixture();
  try {
    await catalog.upsert({ name: "Mullers Pharmacy", category: "Apotheke", address: "1 Beach Road", region: "Jomtien", status: "verified" });
    await catalog.upsert({ name: "Old Pharmacy", category: "pharmacy", address: "2 Beach Road", region: "Jomtien", status: "verified", staleAt: "2020-01-01T00:00:00.000Z" });
    await catalog.upsert({ name: "Naklua Pharmacy", category: "pharmacy", address: "3 Road", region: "Naklua", status: "verified" });
    await catalog.upsert({ name: "Pending Pharmacy", category: "pharmacy", address: "4 Road", region: "Jomtien", status: "pending" });
    const matches = await catalog.searchVerified({ region: "Jomtien", query: "Drugstore", limit: 20 });
    assert.deepEqual(matches.map((place) => place.name), ["Mullers Pharmacy"]);
  } finally {
    await rm2(dir, { recursive: true, force: true });
  }
});
test("queues user hints and blocks a questioned verified entry", async () => {
  const { catalog, dir } = await fixture();
  try {
    const created = await catalog.upsert({ name: "Hint Place", category: "cafe", address: "1 Road", status: "verified" });
    const hint = await catalog.queueUserHint(created.place.id, "Phone number is wrong");
    assert.match(hint.reason, /^User hint:/u);
    assert.equal((await catalog.findById(created.place.id))?.status, "pending");
    assert.equal((await catalog.read()).auditLog.at(-1)?.action, "review_queued");
  } finally {
    await rm2(dir, { recursive: true, force: true });
  }
});
test("blocks conflicting verified updates for manual review", async () => {
  const { catalog, dir } = await fixture();
  try {
    const created = await catalog.upsert({
      name: "Care Clinic",
      category: "clinic",
      address: "1 Jomtien Road",
      phone: "0811111111",
      hours: "09:00-17:00",
      region: "jomtien",
      status: "verified"
    });
    const changed = await catalog.upsert({
      name: "Care Clinic",
      category: "clinic",
      address: "1 Jomtien Road",
      phone: "0811111111",
      hours: "24 hours",
      region: "jomtien",
      status: "verified"
    });
    assert.equal(changed.place.id, created.place.id);
    assert.equal(changed.place.status, "pending");
    assert.match(changed.reviewItem?.reason ?? "", /hours/);
  } finally {
    await rm2(dir, { recursive: true, force: true });
  }
});
test("blocks verified category and region changes for manual review", async () => {
  const { catalog, dir } = await fixture();
  try {
    const created = await catalog.upsert({
      name: "Harbor Place",
      category: "restaurant",
      address: "1 Beach Road",
      region: "jomtien",
      status: "verified"
    });
    const changed = await catalog.upsert({
      name: "Harbor Place",
      category: "clinic",
      address: "1 Beach Road",
      region: "naklua",
      status: "verified"
    });
    assert.equal(changed.place.id, created.place.id);
    assert.equal(changed.place.status, "pending");
    assert.match(changed.reviewItem?.reason ?? "", /category/);
    assert.match(changed.reviewItem?.reason ?? "", /region/);
  } finally {
    await rm2(dir, { recursive: true, force: true });
  }
});
test("blocks newly added coordinates and provenance changes for review", async () => {
  const { catalog, dir } = await fixture();
  try {
    await catalog.upsert({
      name: "Map Place",
      category: "restaurant",
      address: "1 Jomtien Road",
      region: "jomtien",
      status: "verified"
    });
    const withCoordinates = await catalog.upsert({
      name: "Map Place",
      category: "restaurant",
      address: "1 Jomtien Road",
      region: "jomtien",
      status: "verified",
      coordinates: {
        latitude: 12.9,
        longitude: 100.8,
        sourceUrl: "https://example.com/map",
        checkedAt: "2026-09-06T00:00:00.000Z"
      }
    });
    assert.equal(withCoordinates.place.status, "pending");
    assert.match(withCoordinates.reviewItem?.reason ?? "", /coordinates/);
  } finally {
    await rm2(dir, { recursive: true, force: true });
  }
});
test("recovers a damaged catalog from its latest valid backup", async () => {
  const { catalog, dir } = await fixture();
  try {
    await catalog.upsert({
      name: "Backup Pharmacy",
      category: "pharmacy",
      address: "1 Naklua Road",
      region: "naklua",
      status: "verified"
    });
    await catalog.upsert({
      name: "Second Pharmacy",
      category: "pharmacy",
      address: "2 Naklua Road",
      region: "naklua",
      status: "verified"
    });
    const before = await readFile2(catalog.filePath, "utf8");
    assert.match(before, /Second Pharmacy/);
    await writeFile2(catalog.filePath, "{damaged", "utf8");
    const recovered = await catalog.read();
    assert.ok(recovered.places.some((place) => place.name === "Backup Pharmacy"));
  } finally {
    await rm2(dir, { recursive: true, force: true });
  }
});
