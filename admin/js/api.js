/* Fetch wrapper for the admin API. Every request carries X-Requested-With (CSRF guard on the server). */

export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

function handle401(status, path) {
  if (status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('auth:expired'));
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Requested-With': 'fetch', Accept: 'application/json' };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', 0);
  }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    handle401(res.status, path);
    throw new ApiError((isJson && data.error) || `Request failed (${res.status}).`, res.status, isJson ? data.fields : null);
  }
  return data;
}

/** Multipart upload with progress (fetch can't report upload progress). */
export function upload(path, formData, { method = 'POST', onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path);
    xhr.setRequestHeader('X-Requested-With', 'fetch');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.responseType = 'json';
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const data = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      handle401(xhr.status, path);
      reject(new ApiError(data.error || `Upload failed (${xhr.status}).`, xhr.status, data.fields));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed — check your connection.', 0));
    xhr.send(formData);
  });
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });

export const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
};
