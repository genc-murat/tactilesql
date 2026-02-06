import { buildLineageGraph } from '../utils/lineageBuilder.js';

self.onmessage = (event) => {
    const payload = event?.data || {};
    const requestId = payload.requestId;

    try {
        const result = buildLineageGraph(payload.historyEntries, payload.options || {});
        self.postMessage({
            requestId,
            ok: true,
            result,
        });
    } catch (error) {
        self.postMessage({
            requestId,
            ok: false,
            error: String(error || 'Lineage build failed'),
        });
    }
};
