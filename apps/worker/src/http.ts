/**
 * Indirection over the global fetch for outbound calls (LINE, FX provider), so
 * tests can stub external HTTP without affecting bindings.
 */
export const http = {
  fetch: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => fetch(input, init),
};
