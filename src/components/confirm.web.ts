/** Web confirmation dialog (React Native's Alert does nothing on web). */
export function confirm(title: string, message: string): Promise<boolean> {
  return Promise.resolve(window.confirm(`${title}\n\n${message}`));
}

export function notify(title: string, message: string): void {
  window.alert(`${title}\n\n${message}`);
}
