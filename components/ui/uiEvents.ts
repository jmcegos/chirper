/** Window events that let one part of the dashboard steer another without shared state. */

export type ManageTab = 'loans' | 'income' | 'bills' | 'card' | 'spending';

const OPEN_TAB = 'fin:open-tab';
const OPEN_AGENT = 'fin:open-agent';

export function openManageTab(tab: ManageTab): void {
  window.dispatchEvent(new CustomEvent<ManageTab>(OPEN_TAB, { detail: tab }));
}

export function onOpenManageTab(handler: (tab: ManageTab) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<ManageTab>).detail);
  window.addEventListener(OPEN_TAB, listener);
  return () => window.removeEventListener(OPEN_TAB, listener);
}

export function openAgent(): void {
  window.dispatchEvent(new Event(OPEN_AGENT));
}

export function onOpenAgent(handler: () => void): () => void {
  window.addEventListener(OPEN_AGENT, handler);
  return () => window.removeEventListener(OPEN_AGENT, handler);
}
