import { open, type Entry } from "yauzl";

export async function readArchiveEntry(
  file: string,
  name: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    open(file, { lazyEntries: true, autoClose: false }, (error, archive) => {
      if (error || !archive) {
        reject(error ?? new Error(`Unable to open ${file}`));
        return;
      }
      let found: Entry | undefined;
      let settled = false;
      const fail = (failure: Error) => {
        if (settled) return;
        settled = true;
        archive.close();
        reject(failure);
      };
      archive.on("error", fail);
      archive.on("entry", (entry: Entry) => {
        if (entry.fileName === name) found = entry;
        archive.readEntry();
      });
      archive.on("end", () => {
        if (!found) {
          fail(new Error(`There is no item named '${name}' in the archive`));
          return;
        }
        archive.openReadStream(found, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError ?? new Error(`Unable to read ${name}`));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", fail);
          stream.on("end", () => {
            if (settled) return;
            settled = true;
            archive.close();
            resolve(Buffer.concat(chunks));
          });
        });
      });
      archive.readEntry();
    });
  });
}
