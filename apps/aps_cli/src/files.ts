import { chmodSync, copyFileSync, statSync, utimesSync } from "node:fs";

export function copyPreservingMetadata(
  source: string,
  destination: string,
): void {
  copyFileSync(source, destination);
  const stat = statSync(source);
  chmodSync(destination, stat.mode);
  utimesSync(destination, stat.atimeMs / 1000, stat.mtimeMs / 1000);
}
