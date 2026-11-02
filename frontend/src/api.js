const STORAGE_KEY = 'tcg.sessions';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const SESSION_ERRORS = ['NOT_AUTHENTICATED', 'INVALID_SESSION', 'SESSION_EXPIRED'];

export async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the backend server. Check that it is running.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = data && data.error;
    throw new ApiError(res.status, error?.code || 'HTTP_ERROR', error?.message || `Request failed with status ${res.status}`);
  }
  return data;
}

// Accounts signed in on this browser. Each entry holds that account's own
// session token, so switching never bypasses the password check.
export function loadWallet() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && typeof parsed.sessions === 'object') return parsed;
  } catch {
    // ignore unreadable storage
  }
  return { active: null, sessions: {} };
}

export function saveWallet(wallet) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
}

const CONTRACT_CODES = ['INVALID_ARGUMENT', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'];

// Errors raised by the chaincode are labelled so it is clear the smart
// contract refused the transaction.
export function errorText(err) {
  return CONTRACT_CODES.includes(err.code) ? `Rejected by smart contract: ${err.message}` : err.message;
}
