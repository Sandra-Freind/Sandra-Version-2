import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger";
import { sandraCatalog, storeVerifiedPlaces } from "./sandraCatalogRuntime";
import {
  researchLocalPlaces,
  regionLabel,
  type SandraRegion,
} from "./sandraKnowledge";

type DiscoveryState = {
  schemaVersion: 1;
  cursor: number;
  day: string;
  dayCount: number;
  month: string;
  monthCount: number;
  retryCount: number;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
};

const REGIONS: SandraRegion[] = [
  "naklua",
  "wongamat",
  "central",
  "pratumnak",
  "jomtien",
  "darkside",
];
const CATEGORIES = [
  "Apotheke",
  "Arzt oder Klinik",
  "Zahnarzt",
  "Restaurant",
  "Lebensmittelgeschäft",
  "Handyreparatur",
  "Autowerkstatt",
  "Tierarzt",
  "Friseur",
  "Reinigungsdienst",
  "Handwerker",
  "Behörde oder öffentliche Anlaufstelle",
];
const dataDirectory =
  process.env.SANDRA_DATA_DIR?.trim() || path.resolve(process.cwd(), "data");
const statePath = path.join(dataDirectory, "sandra-discovery-state.json");
const lockPath = `${statePath}.lock`;
const dailyLimit = Math.max(
  0,
  Number(process.env.SANDRA_DISCOVERY_DAILY_LIMIT ?? 12) || 0,
);
const monthlyLimit = Math.max(
  0,
  Number(process.env.SANDRA_DISCOVERY_MONTHLY_LIMIT ?? 250) || 0,
);

function dateParts(now = new Date()): { day: string; month: string } {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return { day, month: day.slice(0, 7) };
}

async function readState(): Promise<DiscoveryState> {
  const { day, month } = dateParts();
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as Partial<DiscoveryState>;
    if (parsed.schemaVersion !== 1) throw new Error("Unsupported discovery state.");
    return {
      schemaVersion: 1,
      cursor: Number.isInteger(parsed.cursor) ? Math.max(0, parsed.cursor ?? 0) : 0,
      day,
      dayCount: parsed.day === day ? Math.max(0, parsed.dayCount ?? 0) : 0,
      month,
      monthCount: parsed.month === month ? Math.max(0, parsed.monthCount ?? 0) : 0,
      retryCount: Math.max(0, Math.min(3, parsed.retryCount ?? 0)),
      lastRunAt: parsed.lastRunAt,
      lastSuccessAt: parsed.lastSuccessAt,
      lastError: parsed.lastError,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn({ err: error }, "Sandra discovery state could not be read");
    }
    return {
      schemaVersion: 1,
      cursor: 0,
      day,
      dayCount: 0,
      month,
      monthCount: 0,
      retryCount: 0,
    };
  }
}

async function writeState(state: DiscoveryState): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, statePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function runSandraDiscoveryCycle(): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  let lock;
  const lockOwner = `${process.pid}:${crypto.randomUUID()}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lock = await open(lockPath, "wx");
      await lock.writeFile(lockOwner, "utf8");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return;
    }
  }
  if (!lock) return;
  try {
    await sandraCatalog.markStale();
    const state = await readState();
    if (state.dayCount >= dailyLimit || state.monthCount >= monthlyLimit) return;
    const combinations = REGIONS.length * CATEGORIES.length;
    const index = state.cursor % combinations;
    const region = REGIONS[Math.floor(index / CATEGORIES.length)]!;
    const category = CATEGORIES[index % CATEGORIES.length]!;
    const now = new Date().toISOString();
    state.dayCount += 1;
    state.monthCount += 1;
    state.lastRunAt = now;
    state.lastError = undefined;
    await writeState(state);
    try {
      const result = await researchLocalPlaces(
        `Finde geprüfte ${category} in ${regionLabel(region)}.`,
        region,
      );
      if (result?.verifiedPlaces?.length) {
        await storeVerifiedPlaces(result.verifiedPlaces, region);
      }
      if (!result) {
        state.retryCount += 1;
        state.lastError = `Keine ausreichend prüfbare Antwort für ${category} in ${regionLabel(region)}.`;
        if (state.retryCount >= 3) {
          state.cursor = (index + 1) % combinations;
          state.retryCount = 0;
        }
      } else {
        state.cursor = (index + 1) % combinations;
        state.retryCount = 0;
        state.lastSuccessAt = new Date().toISOString();
        state.lastError = undefined;
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message.slice(0, 300) : "Unbekannter Fehler";
      state.retryCount += 1;
      if (state.retryCount >= 3) {
        state.cursor = (index + 1) % combinations;
        state.retryCount = 0;
      }
      logger.warn({ err: error, region, category }, "Sandra discovery cycle failed");
    }
    await writeState(state);
  } finally {
    await lock.close();
    try {
      if ((await readFile(lockPath, "utf8")) === lockOwner) {
        await rm(lockPath, { force: true });
      }
    } catch {
      // Another process may already have replaced or removed an expired lock.
    }
  }
}

export function startSandraDiscoveryScheduler(): () => void {
  if (process.env.SANDRA_DISCOVERY_ENABLED === "false" || dailyLimit === 0 || monthlyLimit === 0) {
    return () => undefined;
  }
  const intervalMs = Math.max(
    30 * 60_000,
    Number(process.env.SANDRA_DISCOVERY_INTERVAL_MS ?? 6 * 60 * 60_000) ||
      6 * 60 * 60_000,
  );
  const startup = setTimeout(() => {
    void runSandraDiscoveryCycle();
  }, 60_000);
  startup.unref();
  const interval = setInterval(() => {
    void runSandraDiscoveryCycle();
  }, intervalMs);
  interval.unref();
  return () => {
    clearTimeout(startup);
    clearInterval(interval);
  };
}