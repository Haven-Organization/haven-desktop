/*
 * Haven: creates the worker that converts HEIC/HEIF pictures (heic.worker.ts).
 */

export default function factory(options?: WorkerOptions): Worker {
    return new Worker(/* webpackChunkName: "heic.worker" */ new URL("./heic.worker.ts", import.meta.url), options);
}
