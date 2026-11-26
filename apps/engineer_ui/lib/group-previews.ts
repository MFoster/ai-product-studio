import { parseModelGroups } from "./model-groups";
import {
  imageAsset,
  isRecord,
  text,
  type Asset,
  type Finding,
  type GroupPreview,
  type ModelGroup,
  type RecordData,
} from "./types";

export function resolveGroupPreviews(
  reports: { path: string; data: RecordData }[],
  groups: ModelGroup[],
  assets: Asset[],
  product: string,
): { previews: GroupPreview[]; findings: Finding[] } {
  const previews: GroupPreview[] = [];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  for (const report of [...reports].sort((a, b) =>
    b.path.localeCompare(a.path),
  )) {
    function problem(message: string) {
      findings.push({
        severity: "warning",
        message: `Group preview: ${message}`,
        path: report.path,
      });
    }
    if (
      report.data.schema_version !== "1.0" ||
      report.data.product !== product ||
      !Array.isArray(report.data.groups)
    ) {
      problem("invalid preview report schema or product identity.");
      continue;
    }
    for (const item of report.data.groups) {
      if (!isRecord(item)) {
        problem("invalid image record.");
        continue;
      }
      const parsed = parseModelGroups([item.group ?? null]);
      const snapshot = parsed.groups[0];
      if (!snapshot) {
        problem(`invalid group snapshot: ${parsed.errors.join(" ")}`);
        continue;
      }
      const current = groups.find(
        (group) =>
          group.id === snapshot.id && group.revision === snapshot.revision,
      );
      if (!current || seen.has(current.id)) continue;
      seen.add(current.id);
      if (JSON.stringify(snapshot) !== JSON.stringify(current)) {
        problem(
          `${current.name} has changed since its assembly image was rendered.`,
        );
        continue;
      }
      const image = byName.get(text(item.image));
      const source = byName.get(text(report.data.source));
      if (
        !image ||
        !image.name.startsWith("preview/") ||
        !imageAsset(image) ||
        image.sizeMismatch ||
        !image.inventoryValid ||
        image.expectedHash !== item.image_sha256
      ) {
        problem(
          `${current.name} image is missing, untracked, or disagrees with its inventory record.`,
        );
        continue;
      }
      if (
        !source ||
        !source.name.startsWith("source/") ||
        source.missing ||
        source.sizeMismatch ||
        !source.inventoryValid ||
        source.expectedHash !== report.data.source_sha256
      ) {
        problem(
          `${current.name} source is missing or disagrees with the recorded render provenance.`,
        );
        continue;
      }
      const width = item.width;
      const height = item.height;
      if (
        typeof width !== "number" ||
        typeof height !== "number" ||
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 20000 ||
        height > 20000
      ) {
        problem(`${current.name} has invalid image dimensions.`);
        continue;
      }
      previews.push({
        groupId: current.id,
        revision: current.revision,
        image,
        width,
        height,
      });
    }
  }
  return { previews, findings };
}
