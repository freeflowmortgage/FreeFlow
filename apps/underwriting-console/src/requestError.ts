const RELOAD_GUIDANCE = 'Reload FreeFlow to sign in again, then retry.';

/**
 * Browser fetches behind the Cognito-authenticated ALB fail with a bare
 * TypeError when an expired session is redirected to the hosted login page.
 * Turn that opaque browser error into recovery guidance without claiming that
 * every network failure is definitely an authentication failure.
 */
export function describeRequestFailure(error: unknown, action: string): string {
  if (error instanceof TypeError) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return `${action} failed because this device is offline. Reconnect, then retry.`;
    }
    return `${action} could not reach FreeFlow. Your sign-in may have expired. ${RELOAD_GUIDANCE}`;
  }

  return error instanceof Error ? error.message : `${action} failed.`;
}

export function reloadFreeFlow(): void {
  window.location.reload();
}
