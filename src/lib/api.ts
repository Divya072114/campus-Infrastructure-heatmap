export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    token?: string | null;
    body?: unknown;
    isFormData?: boolean;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined && !options.isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body:
      options.body === undefined
        ? undefined
        : options.isFormData
        ? (options.body as FormData)
        : JSON.stringify(options.body),
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      throw new ApiError(data?.error || 'Request failed.', res.status);
    }
    return data as T;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || 'Request failed.', res.status);
  }
  return (await res.text()) as unknown as T;
}

export async function fetchAuthenticatedBlobUrl(
  url: string,
  token: string | null
): Promise<string> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new ApiError('Unable to load attached photo.', res.status);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
