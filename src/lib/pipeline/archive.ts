import "server-only";

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { deflateRaw } from "node:zlib";
import { promisify } from "node:util";

const deflate = promisify(deflateRaw);

/**
 * A minimal ZIP writer.
 *
 * Hand-rolled rather than pulling in a dependency: the format's stored and
 * deflate paths are about eighty lines, and this project has stayed
 * dependency-light on purpose. It also lets the whole archive be assembled in
 * memory-bounded chunks rather than buffering a multi-gigabyte batch.
 *
 * Exists because there was NO way to get artwork back out of the workspace.
 * The directory is gitignored, so a deleted batch was gone — as I found out
 * the hard way. An export is the backup that makes that survivable.
 */

type Entry = {
  /** Path inside the archive, forward slashes. */
  name: string;
  absolutePath: string;
  size: number;
};

/** CRC-32, required by the ZIP central directory. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer, seed = 0): number {
  let crc = (seed ^ -1) >>> 0;
  for (let i = 0; i < buffer.length; i++) {
    crc = (CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ -1) >>> 0;
}

/** DOS timestamp — ZIP predates Unix time in its header format. */
function dosTime(date: Date): { time: number; date: number } {
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2) & 0x1f),
    date:
      ((date.getFullYear() - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

async function readFully(path: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(path)) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Build a ZIP as a stream.
 *
 * Files are read and compressed one at a time, so peak memory is one file
 * rather than the whole archive — a batch of 200MB originals would otherwise
 * be unusable.
 */
export function zipStream(entries: Entry[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const central: Buffer[] = [];
      let offset = 0;

      try {
        for (const entry of entries) {
          const name = Buffer.from(entry.name, "utf8");
          const raw = await readFully(entry.absolutePath);
          const crc = crc32(raw);
          const compressed = await deflate(raw);

          // Only compress when it actually helps. JPEGs and PNGs are already
          // compressed, and deflating them wastes CPU to make the file bigger.
          const useDeflate = compressed.length < raw.length;
          const payload = useDeflate ? compressed : raw;
          const method = useDeflate ? 8 : 0;

          const stats = await stat(entry.absolutePath);
          const { time, date } = dosTime(stats.mtime);

          const local = Buffer.alloc(30);
          local.writeUInt32LE(0x04034b50, 0);
          local.writeUInt16LE(20, 4); // version needed
          local.writeUInt16LE(0x0800, 6); // UTF-8 filenames
          local.writeUInt16LE(method, 8);
          local.writeUInt16LE(time, 10);
          local.writeUInt16LE(date, 12);
          local.writeUInt32LE(crc, 14);
          local.writeUInt32LE(payload.length, 18);
          local.writeUInt32LE(raw.length, 22);
          local.writeUInt16LE(name.length, 26);
          local.writeUInt16LE(0, 28);

          controller.enqueue(local);
          controller.enqueue(name);
          controller.enqueue(payload);

          const dirEntry = Buffer.alloc(46);
          dirEntry.writeUInt32LE(0x02014b50, 0);
          dirEntry.writeUInt16LE(20, 4);
          dirEntry.writeUInt16LE(20, 6);
          dirEntry.writeUInt16LE(0x0800, 8);
          dirEntry.writeUInt16LE(method, 10);
          dirEntry.writeUInt16LE(time, 12);
          dirEntry.writeUInt16LE(date, 14);
          dirEntry.writeUInt32LE(crc, 16);
          dirEntry.writeUInt32LE(payload.length, 20);
          dirEntry.writeUInt32LE(raw.length, 24);
          dirEntry.writeUInt16LE(name.length, 28);
          dirEntry.writeUInt32LE(offset, 42);
          central.push(Buffer.concat([dirEntry, name]));

          offset += local.length + name.length + payload.length;
        }

        const directory = Buffer.concat(central);
        controller.enqueue(directory);

        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(central.length, 8);
        end.writeUInt16LE(central.length, 10);
        end.writeUInt32LE(directory.length, 12);
        end.writeUInt32LE(offset, 16);
        controller.enqueue(end);

        controller.close();
      } catch (cause) {
        controller.error(cause);
      }
    },
  });
}

/** Every file under a directory, as archive entries rooted at `prefix`. */
export async function collectFiles(
  root: string,
  prefix: string,
): Promise<Entry[]> {
  const out: Entry[] = [];

  async function walk(dir: string) {
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else if (item.isFile()) {
        const stats = await stat(full);
        out.push({
          name: `${prefix}/${relative(root, full).split("\\").join("/")}`,
          absolutePath: full,
          size: stats.size,
        });
      }
    }
  }

  await walk(root);
  return out;
}
