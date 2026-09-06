import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SandraCatalog, normalizeCategory } from "./sandraCatalog";

async function fixture(): Promise<{ catalog: SandraCatalog; dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "sandra-catalog-"));
  return { dir, catalog: new SandraCatalog(path.join(dir, "catalog.json"), { maxBackups: 2 }) };
}

test("normalizes categories and updates a duplicate without changing its ID", async () => {
  const { catalog, dir } = await fixture();
  try {
    const first = await catalog.upsert({ name: "Müller's Pharmacy", category: "Apotheke", address: "1 Beach Road", phone: "+66 1234567", status: "verified" });
    const second = await catalog.upsert({ name: "Mullers Pharmacy", category: "Drugstore", address: "1 Beach Road", phone: "+66 1234567", status: "verified" });
    assert.equal(second.action, "updated");
    assert.equal(second.place.id, first.place.id);
    assert.equal(normalizeCategory("Apotheke"), "pharmacy");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("keeps branches with matching names at distinct addresses", async () => {
  const { catalog, dir } = await fixture();
  try {
    const one = await catalog.upsert({ name: "Good Cafe", category: "cafe", address: "1 Road", status: "pending" });
    const two = await catalog.upsert({ name: "Good Cafe", category: "cafe", address: "2 Road", status: "pending" });
    assert.notEqual(one.place.id, two.place.id);
    assert.equal((await catalog.read()).reviewQueue.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("marks expired verified entries stale and retains bounded backups", async () => {
  const { catalog, dir } = await fixture();
  try {
    await catalog.upsert({ name: "Old Place", category: "restaurant", address: "1 Road", status: "verified", checkedAt: "2020-01-01T00:00:00.000Z", staleAt: "2020-01-02T00:00:00.000Z" });
    assert.equal(await catalog.markStale("2021-01-01T00:00:00.000Z"), 1);
    await catalog.upsert({ name: "New Place", category: "restaurant", address: "3 Road" });
    const backups = await readdir(path.join(dir, "catalog.json.backups"));
    assert.ok(backups.length <= 2);
    assert.equal((await catalog.read()).places[0]?.status, "stale");
  } finally { await rm(dir, { recursive: true, force: true }); }
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
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("queues user hints and blocks a questioned verified entry", async () => {
  const { catalog, dir } = await fixture();
  try {
    const created = await catalog.upsert({ name: "Hint Place", category: "cafe", address: "1 Road", status: "verified" });
    const hint = await catalog.queueUserHint(created.place.id, "Phone number is wrong");
    assert.match(hint.reason, /^User hint:/u);
    assert.equal((await catalog.findById(created.place.id))?.status, "pending");
    assert.equal((await catalog.read()).auditLog.at(-1)?.action, "review_queued");
  } finally { await rm(dir, { recursive: true, force: true }); }
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
      status: "verified",
    });
    const changed = await catalog.upsert({
      name: "Care Clinic",
      category: "clinic",
      address: "1 Jomtien Road",
      phone: "0811111111",
      hours: "24 hours",
      region: "jomtien",
      status: "verified",
    });
    assert.equal(changed.place.id, created.place.id);
    assert.equal(changed.place.status, "pending");
    assert.match(changed.reviewItem?.reason ?? "", /hours/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("blocks verified category and region changes for manual review", async () => {
  const { catalog, dir } = await fixture();
  try {
    const created = await catalog.upsert({
      name: "Harbor Place",
      category: "restaurant",
      address: "1 Beach Road",
      region: "jomtien",
      status: "verified",
    });
    const changed = await catalog.upsert({
      name: "Harbor Place",
      category: "clinic",
      address: "1 Beach Road",
      region: "naklua",
      status: "verified",
    });
    assert.equal(changed.place.id, created.place.id);
    assert.equal(changed.place.status, "pending");
    assert.match(changed.reviewItem?.reason ?? "", /category/);
    assert.match(changed.reviewItem?.reason ?? "", /region/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("blocks newly added coordinates and provenance changes for review", async () => {
  const { catalog, dir } = await fixture();
  try {
    await catalog.upsert({
      name: "Map Place",
      category: "restaurant",
      address: "1 Jomtien Road",
      region: "jomtien",
      status: "verified",
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
        checkedAt: "2026-09-06T00:00:00.000Z",
      },
    });
    assert.equal(withCoordinates.place.status, "pending");
    assert.match(withCoordinates.reviewItem?.reason ?? "", /coordinates/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("recovers a damaged catalog from its latest valid backup", async () => {
  const { catalog, dir } = await fixture();
  try {
    await catalog.upsert({
      name: "Backup Pharmacy",
      category: "pharmacy",
      address: "1 Naklua Road",
      region: "naklua",
      status: "verified",
    });
    await catalog.upsert({
      name: "Second Pharmacy",
      category: "pharmacy",
      address: "2 Naklua Road",
      region: "naklua",
      status: "verified",
    });
    const before = await readFile(catalog.filePath, "utf8");
    assert.match(before, /Second Pharmacy/);
    await writeFile(catalog.filePath, "{damaged", "utf8");
    const recovered = await catalog.read();
    assert.ok(recovered.places.some((place) => place.name === "Backup Pharmacy"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});