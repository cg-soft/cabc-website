import { QueryClient } from "@tanstack/react-query";
// Standalone hosting serves the UI and API from the same HTTPS origin.
// No Perplexity preview proxy, API key, or external connector is needed.
const API_BASE = "";
let token: string | null = null;
export function setAuthToken(value: string | null) {
  token = value;
}
export async function apiRequest(method: string, url: string, data?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data !== undefined || ["POST", "PATCH", "PUT"].includes(method))
    headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${url}`, {
      method,
      headers,
      body: data !== undefined ? JSON.stringify(data) : undefined,
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new Error("The club server is unavailable. Please try again in a moment.");
  }
  if (!res.ok) {
    let msg = "We couldn’t complete that request.";
    try {
      const d = await res.json();
      msg = d.message || d.error || msg;
    } catch {}
    if (res.status === 401) msg = "Please sign in again, or check the details you entered.";
    throw new Error(msg);
  }
  return res;
}
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => (await apiRequest("GET", queryKey.join("/"))).json(),
      staleTime: 30000,
      retry: false,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});
