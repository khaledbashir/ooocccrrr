import type { BrochurePageReference, ProposalBrochureAttachment } from "@/types";
import type { StructuredDisplay } from "@/lib/displayExtractor";

const LOCAL_STORAGE_PREFIX = "proposal-brochure-state::";
const DB_NAME = "proposal-brochure-db";
const STORE_NAME = "brochures";
const DB_VERSION = 1;

type PersistedBrochureMetadata = Omit<ProposalBrochureAttachment, "file" | "url">;

type PersistedProposalBrochureState = {
  brochures: PersistedBrochureMetadata[];
  displayRefs: Array<{
    displayId: string;
    displayName: string;
    brochureRef: BrochurePageReference | null;
  }>;
};

type StoredBrochureRecord = PersistedBrochureMetadata & {
  proposalKey: string;
  blob: Blob;
};

function isBrowser() {
  return typeof window !== "undefined";
}

function storageKey(proposalKey: string) {
  return `${LOCAL_STORAGE_PREFIX}${proposalKey}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error || new Error("Failed to open brochure database"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("proposalKey", "proposalKey", { unique: false });
      }
    };
  });
}

function requestToPromise<T = void>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

async function getBrochureRecords(proposalKey: string): Promise<StoredBrochureRecord[]> {
  if (!isBrowser() || !window.indexedDB) return [];

  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const index = store.index("proposalKey");
  const records = await requestToPromise(index.getAll(proposalKey));
  database.close();

  return records as StoredBrochureRecord[];
}

async function saveBrochureRecord(record: StoredBrochureRecord) {
  if (!isBrowser() || !window.indexedDB) return;

  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  store.put(record);

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Failed to save brochure"));
    transaction.onabort = () => reject(transaction.error || new Error("Failed to save brochure"));
  });
  database.close();
}

async function deleteBrochureRecord(id: string) {
  if (!isBrowser() || !window.indexedDB) return;

  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).delete(id);

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Failed to delete brochure"));
    transaction.onabort = () => reject(transaction.error || new Error("Failed to delete brochure"));
  });
  database.close();
}

export function buildProposalStorageKey(input: { historyId?: string | null; fileName?: string | null; fallback?: string | null }) {
  if (input.historyId) return `history:${input.historyId}`;
  if (input.fileName) return `file:${input.fileName.toLowerCase()}`;
  return input.fallback || "proposal:workspace";
}

export function mergeDisplaysWithBrochureRefs(
  displays: StructuredDisplay[],
  displayRefs: PersistedProposalBrochureState["displayRefs"],
) {
  if (displayRefs.length === 0) return displays;

  return displays.map((display) => {
    const match =
      displayRefs.find((item) => item.displayId === display.id) ||
      displayRefs.find((item) => item.displayName.toLowerCase() === display.name.toLowerCase());

    return match
      ? {
          ...display,
          brochureRef: match.brochureRef,
        }
      : {
          ...display,
          brochureRef: display.brochureRef ?? null,
        };
  });
}

export async function loadProposalBrochureState(proposalKey: string): Promise<{
  brochures: ProposalBrochureAttachment[];
  displayRefs: PersistedProposalBrochureState["displayRefs"];
}> {
  if (!isBrowser()) {
    return { brochures: [], displayRefs: [] };
  }

  let parsedState: PersistedProposalBrochureState = { brochures: [], displayRefs: [] };
  const raw = window.localStorage.getItem(storageKey(proposalKey));
  if (raw) {
    try {
      parsedState = JSON.parse(raw) as PersistedProposalBrochureState;
    } catch {
      parsedState = { brochures: [], displayRefs: [] };
    }
  }

  const records = await getBrochureRecords(proposalKey);
  const recordMap = new Map(records.map((record) => [record.id, record]));

  const brochures: ProposalBrochureAttachment[] = [];

  for (const metadata of parsedState.brochures) {
    const record = recordMap.get(metadata.id);
    if (!record) continue;

    const file = new File([record.blob], record.name, {
      type: record.type || "application/pdf",
      lastModified: record.lastModified,
    });

    brochures.push({
      ...metadata,
      file,
      url: URL.createObjectURL(file),
    });
  }

  return {
    brochures,
    displayRefs: parsedState.displayRefs || [],
  };
}

export async function saveProposalBrochureState(
  proposalKey: string,
  brochures: ProposalBrochureAttachment[],
  displays: StructuredDisplay[],
) {
  if (!isBrowser()) return;

  const metadata = brochures.map(({ id, name, size, lastModified, type }) => ({
    id,
    name,
    size,
    lastModified,
    type,
  }));

  const displayRefs = displays.map((display) => ({
    displayId: display.id,
    displayName: display.name,
    brochureRef: display.brochureRef ?? null,
  }));

  window.localStorage.setItem(
    storageKey(proposalKey),
    JSON.stringify({
      brochures: metadata,
      displayRefs,
    } satisfies PersistedProposalBrochureState),
  );

  await Promise.all(
    brochures.map(async (brochure) => {
      if (!brochure.file) return;
      await saveBrochureRecord({
        id: brochure.id,
        proposalKey,
        name: brochure.name,
        size: brochure.size,
        lastModified: brochure.lastModified,
        type: brochure.type,
        blob: brochure.file,
      });
    }),
  );
}

export async function removeProposalBrochure(proposalKey: string, brochureId: string) {
  if (!isBrowser()) return;

  const raw = window.localStorage.getItem(storageKey(proposalKey));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as PersistedProposalBrochureState;
      const nextState: PersistedProposalBrochureState = {
        brochures: parsed.brochures.filter((item) => item.id !== brochureId),
        displayRefs: parsed.displayRefs.map((item) => ({
          ...item,
          brochureRef: item.brochureRef?.brochureId === brochureId ? null : item.brochureRef,
        })),
      };
      window.localStorage.setItem(storageKey(proposalKey), JSON.stringify(nextState));
    } catch {
      window.localStorage.removeItem(storageKey(proposalKey));
    }
  }

  await deleteBrochureRecord(brochureId);
}

export function revokeBrochureUrls(brochures: ProposalBrochureAttachment[]) {
  for (const brochure of brochures) {
    if (brochure.url) {
      URL.revokeObjectURL(brochure.url);
    }
  }
}
