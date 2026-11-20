export function $(id: string): HTMLElement;
export function $<T extends HTMLElement>(id: string, type: new () => T): T;
export function $(id: string, type: new () => HTMLElement = HTMLElement): HTMLElement {
  const node = document.getElementById(id);

  if (!(node instanceof type)) throw new Error(`Missing or unexpected element #${id}`);

  return node;
}
