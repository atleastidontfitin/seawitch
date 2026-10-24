declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string, options?: { pretendToBeVisual?: boolean; url?: string });
    window: {
      document: unknown;
      DOMParser: unknown;
      XMLSerializer: unknown;
      Element: unknown;
      HTMLElement: unknown;
      SVGElement: {
        prototype: {
          getBBox?: () => { x: number; y: number; width: number; height: number };
          getComputedTextLength?: () => number;
        };
      };
      SVGSVGElement: unknown;
      Node: unknown;
      navigator: unknown;
      getComputedStyle: (element: unknown) => unknown;
      CSSStyleSheet: unknown;
    };
  }
}
