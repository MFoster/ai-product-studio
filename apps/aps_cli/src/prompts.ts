import { createInterface } from "node:readline";
import { formatGeneral, parseDecimal } from "./numbers.js";
import { floatString } from "./slicer.js";

function asciiDigits(value: string): string {
  return Array.from(value, (character) => {
    if (!/\p{Decimal_Number}/u.test(character) || /^[0-9]$/.test(character))
      return character;
    const point = character.codePointAt(0);
    if (point === undefined) return character;
    let start = point;
    while (
      start > 0 &&
      /\p{Decimal_Number}/u.test(String.fromCodePoint(start - 1))
    )
      start--;
    return String((point - start) % 10);
  }).join("");
}

export class Prompts {
  private readonly readline = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  private readonly lines = this.readline[Symbol.asyncIterator]();

  async ask(
    label: string,
    defaultValue?: string,
    required = false,
  ): Promise<string> {
    while (true) {
      process.stdout.write(
        `${label}${defaultValue === undefined ? "" : ` [${defaultValue}]`}: `,
      );
      const result = await this.lines.next();
      if (result.done) throw new Error("Aborted!");
      const value = result.value === "" ? (defaultValue ?? "") : result.value;
      if (!required || value !== "") return value;
      console.log("Error: This field is required.");
    }
  }

  async number(label: string, value: number, integer = false): Promise<number> {
    while (true) {
      const answer = await this.ask(
        label,
        integer
          ? String(value)
          : Number.isFinite(value)
            ? floatString(value)
            : formatGeneral(value),
      );
      const text = asciiDigits(answer.trim());
      let result =
        integer && !/^[+-]?\d(?:_?\d)*$/.test(text)
          ? undefined
          : parseDecimal(text);
      if (
        !integer &&
        result === undefined &&
        /^[+-]?(?:inf(?:inity)?|nan)$/i.test(text)
      )
        result = text.toLowerCase().includes("nan")
          ? NaN
          : text.startsWith("-")
            ? -Infinity
            : Infinity;
      if (result !== undefined && (!integer || Number.isFinite(result)))
        return result;
      console.log(
        `Error: '${answer}' is not a valid ${integer ? "int" : "float"}.`,
      );
    }
  }

  async confirm(label: string, defaultValue: boolean): Promise<boolean> {
    while (true) {
      process.stdout.write(`${label} [${defaultValue ? "Y/n" : "y/N"}]: `);
      const result = await this.lines.next();
      if (result.done) throw new Error("Aborted!");
      const value = result.value.trim().toLowerCase();
      if (!value) return defaultValue;
      if (["y", "yes"].includes(value)) return true;
      if (["n", "no"].includes(value)) return false;
      console.log("Error: invalid input");
    }
  }

  close(): void {
    this.readline.close();
  }
}
