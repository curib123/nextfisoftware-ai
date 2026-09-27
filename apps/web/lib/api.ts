export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: 'USER' | 'ADMIN';
  accountType: 'REAL' | 'STARTER' | 'OFFICIAL';
  plan: 'FREE' | 'STARTER' | 'PRO' | 'MAX';
  onboardingCompleted: boolean;
}
export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function getApiBaseUrl() {
  if (typeof window !== 'undefined') return `${window.location.origin}/api/v1`;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return `${site.replace(/\/$/, '')}/api/v1`;
}
export async function apiRequest<T>(
  path: string,
  options: RequestInit & { accessToken?: string } = {},
): Promise<T> {
  const { accessToken, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set('X-Vrompt-Client', 'web');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401 && accessToken && typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('vrompt:session-expired', { detail: accessToken }),
    );
  if (!response.ok)
    throw new ApiError(
      Array.isArray(body?.message)
        ? body.message.join(', ')
        : (body?.message ?? 'Request failed. Please try again.'),
      response.status,
    );
  return body as T;
}
export type Model = {
  creditCosts?: { chat: number | null; image_generation: number | null };
  available?: boolean;
  autoAvailable?: boolean;
  id: string;
  provider: string;
  displayName: string;
  description: string;
  capabilities: string[];
  capabilityStates?: Record<
    string,
    'NATIVE_PROVIDER' | 'VROMPT' | 'UNAVAILABLE'
  >;
  reasoningLevels?: string[];
  defaultReasoningLevel?: string;
  enabled?: boolean;
  maintenance?: boolean;
};
export type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
  projectId?: string | null;
};
export type Message = {
  artifacts?: ChatFile[];
  id: string;
  role: string;
  content: string;
  modelName?: string;
  routingMode?: string;
  status: string;
};
export type ChatFile = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
};
export type SavedPrompt = { id: string; title: string; content: string };
export type Usage = {
  credits?: {
    limit: number;
    remaining: number;
    used?: number;
    reserved?: number;
  };
  features?: {
    projects: boolean;
    workflows: boolean;
    maxWorkflowSteps: number;
  };
  plan: string;
  resets: { daily: string; monthly: string };
  allowances: {
    creditCosts?: { chat: number | null; image_generation: number | null };
    bucket: string;
    modelName?: string | null;
    provider?: string | null;
    allowedFeatures: string[];
    dailyRemaining: number;
    monthlyRemaining: number;
    dailyLimit: number;
    monthlyLimit: number;
    maxFiles: number;
    maxFileBytes: number;
  }[];
};
