// INACTIVE EXPERIMENT
//
// v6 adjacent-window ranking is intentionally not wired into Search.tsx.
// It caused unacceptable main-thread stalls while typing/pasting searches.
// Preserve the design idea only; any future version must precompute/cache its
// normalized structures or run the expensive work in a Web Worker.
