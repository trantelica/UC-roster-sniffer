// IndexedDB persistence boundary for the active workspace (Completion Milestone A1).
//
// This module is the ONLY place that talks to IndexedDB. It is intentionally kept out of
// `src/engine` so the pure, deterministic engine logic never depends on browser storage.
// The persistence payload is the existing portable workspace snapshot contract
// (`buildWorkspaceSnapshot` / `restoreWorkspaceFromSnapshot`); we do not invent a second
// workspace persistence format.
//
// Scope (A1): automatic save/restore of one active workspace record. No localStorage, no
// backend, no sync, no schema reshaping. Corrupt/unsupported records surface a calm error
// state and are never auto-deleted.

import {
  validateWorkspaceSnapshot,
  restoreWorkspaceFromSnapshot,
  type WorkspaceSnapshot,
  type WorkspaceRestoreResult,
} from '../engine/workspaceSnapshot';

export const WORKSPACE_DB_NAME = 'uc-roster-sniffer';
export const WORKSPACE_DB_VERSION = 1;
export const WORKSPACE_STORE_NAME = 'workspace';
export const ACTIVE_WORKSPACE_ID = 'active-workspace';
/** Bumped only if the IndexedDB record envelope (not the snapshot contract) changes. */
export const WORKSPACE_PERSISTENCE_VERSION = 1;

/** The single record stored under {@link ACTIVE_WORKSPACE_ID} in the workspace store. */
export type PersistedWorkspaceRecord = {
  id: string;
  persistenceVersion: number;
  savedAt: string;
  snapshot: WorkspaceSnapshot;
};

/** Raw outcome of reading the store, before snapshot validation. */
export type LoadWorkspaceResult =
  | { status: 'empty' }
  | { status: 'found'; record: PersistedWorkspaceRecord }
  | { status: 'error'; reason: string };

/** Resolved outcome after validating/restoring a found record. */
export type ResolvedWorkspaceLoad =
  | { status: 'empty' }
  | { status: 'restored'; restore: WorkspaceRestoreResult; savedAt: string }
  | { status: 'error'; reason: string };

function resolveFactory(explicit?: IDBFactory): IDBFactory {
  const factory =
    explicit ??
    (typeof globalThis !== 'undefined'
      ? (globalThis as { indexedDB?: IDBFactory }).indexedDB
      : undefined);
  if (!factory) {
    throw new Error('IndexedDB is not available in this environment.');
  }
  return factory;
}

function openWorkspaceDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKSPACE_STORE_NAME)) {
        db.createObjectStore(WORKSPACE_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open the workspace database.'));
    request.onblocked = () =>
      reject(new Error('Opening the workspace database was blocked.'));
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown IndexedDB error.';
}

/**
 * Saves the given snapshot as the single active workspace record, overwriting any prior
 * record. The input snapshot is never mutated (IndexedDB structured-clones on write).
 */
export async function saveWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  savedAt: string,
  factory?: IDBFactory
): Promise<void> {
  const db = openWorkspaceDb(resolveFactory(factory));
  const database = await db;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(WORKSPACE_STORE_NAME, 'readwrite');
      const record: PersistedWorkspaceRecord = {
        id: ACTIVE_WORKSPACE_ID,
        persistenceVersion: WORKSPACE_PERSISTENCE_VERSION,
        savedAt,
        snapshot,
      };
      tx.objectStore(WORKSPACE_STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save the workspace.'));
      tx.onabort = () => reject(tx.error ?? new Error('Saving the workspace was aborted.'));
    });
  } finally {
    database.close();
  }
}

/**
 * Reads the active workspace record. Returns `empty` when nothing is stored and a calm
 * `error` (never a throw) when IndexedDB is unavailable or the read fails, so the app can
 * fall back to its default startup state.
 */
export async function loadWorkspaceRecord(
  factory?: IDBFactory
): Promise<LoadWorkspaceResult> {
  let database: IDBDatabase | null = null;
  try {
    database = await openWorkspaceDb(resolveFactory(factory));
    const record = await new Promise<PersistedWorkspaceRecord | undefined>(
      (resolve, reject) => {
        const tx = database!.transaction(WORKSPACE_STORE_NAME, 'readonly');
        const getRequest = tx.objectStore(WORKSPACE_STORE_NAME).get(ACTIVE_WORKSPACE_ID);
        getRequest.onsuccess = () =>
          resolve(getRequest.result as PersistedWorkspaceRecord | undefined);
        getRequest.onerror = () =>
          reject(getRequest.error ?? new Error('Failed to read the workspace.'));
      }
    );
    if (record === undefined || record === null) {
      return { status: 'empty' };
    }
    return { status: 'found', record };
  } catch (error) {
    return { status: 'error', reason: errorMessage(error) };
  } finally {
    if (database) database.close();
  }
}

/**
 * Pure decision layer: turns a raw {@link LoadWorkspaceResult} into a restore outcome by
 * validating and restoring the stored snapshot through the existing snapshot contract.
 * Testable without IndexedDB or React. A malformed record, an unsupported persistence
 * version, or a snapshot that fails validation all resolve to a calm `error` (the stored
 * record is left untouched for the caller to decide on).
 */
export function resolvePersistedWorkspaceLoad(
  result: LoadWorkspaceResult
): ResolvedWorkspaceLoad {
  if (result.status === 'empty') return { status: 'empty' };
  if (result.status === 'error') return { status: 'error', reason: result.reason };

  const record = result.record as PersistedWorkspaceRecord | null | undefined;
  if (!record || typeof record !== 'object') {
    return { status: 'error', reason: 'Stored workspace record is malformed.' };
  }
  if (record.persistenceVersion !== WORKSPACE_PERSISTENCE_VERSION) {
    return {
      status: 'error',
      reason: `Unsupported persistence version: ${String(record.persistenceVersion)}.`,
    };
  }

  // A persisted reset-to-empty workspace is a legitimate state to restore (unlike a
  // hand-shared Dataset Import, which still rejects an empty file).
  const validation = validateWorkspaceSnapshot(record.snapshot, { allowEmptyWorkspace: true });
  if (!validation.ok) {
    return {
      status: 'error',
      reason: `Stored snapshot is invalid: ${validation.errors
        .map((e) => e.code)
        .join(', ')}.`,
    };
  }

  return {
    status: 'restored',
    restore: restoreWorkspaceFromSnapshot(validation.snapshot),
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
  };
}
