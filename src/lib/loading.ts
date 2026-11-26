/** Keep the shared indicator visible until every concurrent operation finishes. */
export async function withLoading<T>(operation: () => Promise<T>): Promise<T> {
  window.dispatchEvent(new Event('sellio:loading-start'));
  try { return await operation(); }
  finally { window.dispatchEvent(new Event('sellio:loading-end')); }
}
