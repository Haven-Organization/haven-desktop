/*
 * Haven: IndexedDB for games in the bundled webxdc sandbox (res/webxdc-sandbox/game/), built on its
 * own as webxdc-sandbox/game/idb.js (see webpack.config.ts).
 *
 * The bundled sandbox's frame has an origin of its own, which browsers give no IndexedDB. Games get
 * one kept in memory (fake-indexeddb) instead, filled from the player's save when the game starts,
 * and written back into the save shortly after each change, so it lasts like the game's
 * localStorage does. The sandbox's loader calls install() before the game's page is written.
 */

import {
    IDBCursor,
    IDBCursorWithValue,
    IDBDatabase,
    IDBFactory,
    IDBIndex,
    IDBKeyRange,
    IDBObjectStore,
    IDBOpenDBRequest,
    IDBRequest,
    IDBTransaction,
    IDBVersionChangeEvent,
} from "fake-indexeddb";

/** The save's key for the game's IndexedDB. Hidden from the game's localStorage (see runtime.js). */
export const SAVE_SLOT = "{xdc-indexeddb}";

/** How soon after a change the databases are written into the save. */
const SNAPSHOT_DELAY_MS = 300;

/** Snapshots bigger than this aren't kept, so the rest of the save still fits (it's 5 MB at most). */
const MAX_SNAPSHOT_LENGTH = 4 * 1024 * 1024;

/** All of a game's databases, as kept in its save (as JSON). */
export interface Snapshot {
    v: 1;
    dbs: DatabaseSnapshot[];
}

interface DatabaseSnapshot {
    name: string;
    version: number;
    stores: StoreSnapshot[];
}

interface StoreSnapshot {
    name: string;
    keyPath: string | string[] | null;
    autoIncrement: boolean;
    indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[];
    /** Out-of-line keys, or null when the store's keys are in its values. */
    keys: unknown[] | null;
    values: unknown[];
}

// Values are kept as JSON. Anything JSON can't hold is an object with a "$" type tag; a plain object
// that has a "$" of its own is tagged too, so it can't be taken for one.

function toBase64(bytes: Uint8Array): string {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(text);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

const VIEWS: Record<string, new (buffer: ArrayBuffer) => ArrayBufferView> = {
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    DataView,
};

/** A value (or key) as JSON. Blobs are read, so it's async. Repeated objects are kept once each. */
export async function encode(value: unknown, seen = new Set<object>()): Promise<unknown> {
    switch (typeof value) {
        case "undefined":
            return { $: "u" };
        case "bigint":
            return { $: "n", v: value.toString() };
        case "number":
            if (Object.is(value, -0)) return { $: "x", v: "-0" };
            return Number.isFinite(value) ? value : { $: "x", v: String(value) };
        case "string":
        case "boolean":
            return value;
        case "object":
            break;
        default:
            return null;
    }
    if (value === null) return null;
    if (seen.has(value)) return null;
    seen.add(value);
    if (value instanceof Date) return { $: "d", v: value.getTime() };
    if (value instanceof RegExp) return { $: "r", s: value.source, f: value.flags };
    if (value instanceof ArrayBuffer) return { $: "ab", v: toBase64(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return { $: "ta", t: value.constructor.name, v: toBase64(bytes) };
    }
    if (value instanceof Blob) {
        const bytes = toBase64(new Uint8Array(await value.arrayBuffer()));
        if (value instanceof File) return { $: "f", n: value.name, t: value.type, m: value.lastModified, v: bytes };
        return { $: "b", t: value.type, v: bytes };
    }
    if (value instanceof Map) {
        const entries = [];
        for (const [k, v] of value) entries.push([await encode(k, seen), await encode(v, seen)]);
        return { $: "m", v: entries };
    }
    if (value instanceof Set) {
        const items = [];
        for (const item of value) items.push(await encode(item, seen));
        return { $: "s", v: items };
    }
    if (Array.isArray(value)) {
        const items = [];
        for (const item of value) items.push(await encode(item, seen));
        return items;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await encode(v, seen);
    return "$" in out ? { $: "o", v: out } : out;
}

/** The value a JSON copy from encode() stands for. */
export function decode(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(decode);
    if (!value || typeof value !== "object") return value;
    const tagged = value as Record<string, any>;
    switch (tagged.$) {
        case undefined:
            return Object.fromEntries(Object.entries(tagged).map(([k, v]) => [k, decode(v)]));
        case "o":
            return Object.fromEntries(Object.entries(tagged.v as object).map(([k, v]) => [k, decode(v)]));
        case "u":
            return undefined;
        case "n":
            return BigInt(tagged.v);
        case "x":
            return Number(tagged.v);
        case "d":
            return new Date(tagged.v);
        case "r":
            return new RegExp(tagged.s, tagged.f);
        case "ab":
            return fromBase64(tagged.v).buffer;
        case "ta": {
            const View = VIEWS[tagged.t] ?? Uint8Array;
            return new View(fromBase64(tagged.v).buffer);
        }
        case "b":
            return new Blob([fromBase64(tagged.v)], { type: tagged.t });
        case "f":
            return new File([fromBase64(tagged.v)], tagged.n, { type: tagged.t, lastModified: tagged.m });
        case "m":
            return new Map((tagged.v as unknown[][]).map(([k, v]) => [decode(k), decode(v)]));
        case "s":
            return new Set((tagged.v as unknown[]).map(decode));
        default:
            return null;
    }
}

function done<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function finished(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

/** Opens a database without holding up the game: it's closed again if the game wants to upgrade it. */
async function openQuietly(factory: IDBFactory, name: string, version?: number): Promise<IDBDatabase> {
    const request = factory.open(name, version);
    const db = await done(request);
    db.onversionchange = () => db.close();
    return db;
}

/** Copies every database a factory has. */
export async function snapshot(factory: IDBFactory): Promise<Snapshot> {
    const dbs: DatabaseSnapshot[] = [];
    for (const info of await factory.databases()) {
        if (!info.name) continue;
        const db = await openQuietly(factory, info.name);
        try {
            const raw: (Omit<StoreSnapshot, "keys" | "values"> & { keys: IDBValidKey[]; values: unknown[] })[] = [];
            const names = Array.from(db.objectStoreNames);
            if (names.length) {
                const transaction = db.transaction(names, "readonly");
                const reads = names.map(async (name) => {
                    // A store's details can only be read while its transaction is open.
                    const store = transaction.objectStore(name);
                    const details = {
                        name: store.name,
                        keyPath: store.keyPath,
                        autoIncrement: store.autoIncrement,
                        indexes: Array.from(store.indexNames, (indexName) => {
                            const index = store.index(indexName);
                            return {
                                name: index.name,
                                keyPath: index.keyPath,
                                unique: index.unique,
                                multiEntry: index.multiEntry,
                            };
                        }),
                    };
                    const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
                    raw.push({ ...details, keys, values });
                });
                await Promise.all([...reads, finished(transaction)]);
            }
            const stores: StoreSnapshot[] = [];
            for (const { keys, values, ...details } of raw) {
                stores.push({
                    ...details,
                    keys: details.keyPath === null ? await Promise.all(keys.map((key) => encode(key))) : null,
                    values: await Promise.all(values.map((value) => encode(value))),
                });
            }
            dbs.push({ name: db.name, version: db.version, stores });
        } finally {
            db.close();
        }
    }
    return { v: 1, dbs };
}

/** Fills an empty factory from a snapshot. */
export async function restore(factory: IDBFactory, saved: Snapshot): Promise<void> {
    for (const data of saved.dbs) {
        const request = factory.open(data.name, data.version);
        request.onupgradeneeded = () => {
            const db = request.result;
            for (const store of data.stores) {
                const created = db.createObjectStore(store.name, {
                    keyPath: store.keyPath,
                    autoIncrement: store.autoIncrement,
                });
                for (const index of store.indexes) {
                    created.createIndex(index.name, index.keyPath, {
                        unique: index.unique,
                        multiEntry: index.multiEntry,
                    });
                }
                // Explicit keys also move an autoIncrement store's next key past them.
                store.values.forEach((value, i) => {
                    if (store.keys) created.put(decode(value), decode(store.keys[i]) as IDBValidKey);
                    else created.put(decode(value));
                });
            }
        };
        const db = await done(request);
        db.close();
    }
}

function isSnapshot(value: unknown): value is Snapshot {
    return (
        !!value && typeof value === "object" && (value as Snapshot).v === 1 && Array.isArray((value as Snapshot).dbs)
    );
}

/** What install() is given: the window, the snapshot from the save, and where to put new ones. */
export interface InstallOptions {
    win: Window & typeof globalThis;
    saved: string | null | undefined;
    keep: (snapshot: string) => void;
}

/**
 * Gives the window an IndexedDB filled from the save, which writes itself into it after changes.
 * Resolves once the saved databases are back.
 */
export async function install({ win, saved, keep }: InstallOptions): Promise<void> {
    const factory = new IDBFactory();
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (isSnapshot(parsed)) await restore(factory, parsed);
        } catch (e) {
            console.warn("webxdc: the game's saved IndexedDB couldn't be restored", e);
        }
    }

    // A change is written into the save a moment later; one at a time.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let writing: Promise<void> | undefined;
    let again = false;
    const write = (): Promise<void> => {
        clearTimeout(timer);
        timer = undefined;
        if (writing) {
            again = true;
            return writing;
        }
        writing = (async () => {
            try {
                const json = JSON.stringify(await snapshot(factory));
                if (json.length <= MAX_SNAPSHOT_LENGTH) keep(json);
                else console.warn("webxdc: the game's IndexedDB is too big to keep in its save");
            } catch (e) {
                console.warn("webxdc: couldn't copy the game's IndexedDB", e);
            } finally {
                writing = undefined;
                if (again) {
                    again = false;
                    changed();
                }
            }
        })();
        return writing;
    };
    const changed = (): void => {
        clearTimeout(timer);
        timer = setTimeout(write, SNAPSHOT_DELAY_MS);
    };

    // Changes: transactions that write, upgrades, and deleted databases. The methods are wrapped,
    // and called with the `this` they're called with.
    // oxlint-disable-next-line typescript/unbound-method
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<typeof transaction>) {
        const started = transaction.apply(this, args);
        if (started.mode !== "readonly") started.addEventListener("complete", changed);
        return started;
    };
    const open = factory.open.bind(factory);
    factory.open = (...args: Parameters<typeof open>) => {
        const request = open(...args);
        let upgraded = false;
        request.addEventListener("upgradeneeded", () => (upgraded = true));
        request.addEventListener("success", () => upgraded && changed());
        return request;
    };
    const deleteDatabase = factory.deleteDatabase.bind(factory);
    factory.deleteDatabase = (...args: Parameters<typeof deleteDatabase>) => {
        const request = deleteDatabase(...args);
        request.addEventListener("success", changed);
        return request;
    };

    // Haven's Save button, and before the game closes: what's waiting is written now.
    win.addEventListener("xdc-save", (event) => {
        if (timer === undefined && !writing) return;
        (event as CustomEvent<{ wait?: (done: Promise<unknown>) => void }>).detail?.wait?.(write());
    });

    const globals: Record<string, unknown> = {
        indexedDB: factory,
        IDBFactory,
        IDBDatabase,
        IDBTransaction,
        IDBObjectStore,
        IDBIndex,
        IDBCursor,
        IDBCursorWithValue,
        IDBKeyRange,
        IDBRequest,
        IDBOpenDBRequest,
        IDBVersionChangeEvent,
    };
    for (const [name, value] of Object.entries(globals)) {
        try {
            Object.defineProperty(win, name, { configurable: true, writable: true, value });
        } catch {
            // Then the game gets the browser's own, which won't work here.
        }
    }
}

declare global {
    interface Window {
        xdcIndexedDB?: { install: typeof install; SAVE_SLOT: string };
    }
}

if (typeof window !== "undefined") window.xdcIndexedDB = { install, SAVE_SLOT };
