import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SandraCatalogData } from "./sandraCatalog";

const SEED_FILES = [
  "naklua.json",
  "wongamat.json",
  "central.json",
  "pratumnak.json",
  "jomtien.json",
  "darkside.json",
] as const;

/**
 * Hostinger deploys only tracked repository files. The mutable runtime catalog
 * is therefore rebuilt once from tracked regional seed files when it is absent.
 * Existing runtime data always wins and is never overwritten on startup.
 */
export function ensureCatalogSeed(dataDirectory: string): void {
  const target = path.join(dataDirectory, "sandra-catalog.json");
  if (existsSync(target)) return;

  const seedDirectory = path.join(process.cwd(), "data", "seed");
  const places: SandraCatalogData["places"] = [];

  for (const fileName of SEED_FILES) {
    const filePath = path.join(seedDirectory, fileName);
    if (!existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<SandraCatalogData>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.places)) continue;
      places.push(...parsed.places);
    } catch {
      // One damaged regional seed must not prevent the server from starting.
    }
  }

  if (places.length === 0) return;
  const unique = new Map(places.map((place) => [place.id, place]));
  const catalog: SandraCatalogData = {
    schemaVersion: 1,
    places: [...unique.values()],
    reviewQueue: [],
    auditLog: [],
  };

  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}
