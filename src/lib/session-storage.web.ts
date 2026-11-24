// Web: use the browser's own storage (none during server rendering)
export const sessionStorage: Storage | undefined = typeof window === 'undefined' ? undefined : window.localStorage;
