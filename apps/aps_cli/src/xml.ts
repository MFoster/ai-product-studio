function escape(value: string, attribute: boolean): string {
  const text = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return attribute
    ? text
        .replaceAll('"', "&quot;")
        .replaceAll("\n", "&#10;")
        .replaceAll("\r", "&#13;")
        .replaceAll("\t", "&#9;")
    : text;
}

export class Xml {
  readonly children: Xml[] = [];
  text = "";

  constructor(
    readonly name: string,
    readonly attributes: Record<string, string | number> = {},
  ) {}

  add(name: string, attributes: Record<string, string | number> = {}): Xml {
    const child = new Xml(name, attributes);
    this.children.push(child);
    return child;
  }

  render(): string {
    const attrs = Object.entries(this.attributes)
      .map(([key, value]) => ` ${key}="${escape(String(value), true)}"`)
      .join("");
    if (!this.text && !this.children.length) return `<${this.name}${attrs} />`;
    return `<${this.name}${attrs}>${escape(this.text, false)}${this.children.map((child) => child.render()).join("")}</${this.name}>`;
  }

  document(): string {
    return `<?xml version="1.0" encoding="utf-8"?>\n${this.render()}`;
  }
}
