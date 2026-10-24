import { JSDOM } from 'jsdom';

let prepared = false;

export async function mermaidAccepts(source: string): Promise<boolean> {
  await ensureDom();
  const mermaid = (await import('mermaid')).default;
  try {
    await mermaid.parse(source);
    return true;
  } catch {
    return false;
  }
}

export async function renderMermaid(source: string, id: string): Promise<string> {
  await ensureDom();
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false });
  const rendered = await mermaid.render(id, source);
  return rendered.svg;
}

async function ensureDom(): Promise<void> {
  if (prepared) {
    return;
  }
  prepared = true;
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const { window } = dom;
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.DOMParser = window.DOMParser;
  globals.XMLSerializer = window.XMLSerializer;
  globals.Element = window.Element;
  globals.HTMLElement = window.HTMLElement;
  globals.SVGElement = window.SVGElement;
  globals.SVGSVGElement = window.SVGSVGElement;
  globals.Node = window.Node;
  globals.getComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  class StyleSheet {
    cssRules: { cssText: string }[] = [];

    insertRule(rule: string, index = this.cssRules.length): number {
      this.cssRules.splice(index, 0, { cssText: rule });
      return index;
    }

    deleteRule(index: number): void {
      this.cssRules.splice(index, 1);
    }

    replaceSync(text: string): void {
      this.cssRules = text ? [{ cssText: text }] : [];
    }

    replace(text: string): Promise<StyleSheet> {
      this.replaceSync(text);
      return Promise.resolve(this);
    }
  }
  const styleSheet = StyleSheet as unknown as { new (): unknown };
  globals.CSSStyleSheet = styleSheet;
  window.CSSStyleSheet = styleSheet;
  const graphics = window.SVGElement.prototype;
  graphics.getBBox ??= () => ({ x: 0, y: 0, width: 100, height: 20 });
  graphics.getComputedTextLength ??= () => 100;
}
