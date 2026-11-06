// Minimaler ZIP-Writer/-Reader ohne Abhängigkeiten (nur node:zlib).
// Reicht für Backups: Einträge bis 4 GB, kein ZIP64, keine Verschlüsselung.
import zlib from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const FLAG_UTF8 = 0x0800;

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Schreibt ein ZIP nacheinander in einen Stream (z.B. die HTTP-Antwort).
 * add(name, data, { compress }) – data: Buffer; Bilder besser unkomprimiert (compress: false).
 */
export class ZipWriter {
  constructor(out) {
    this.out = out;
    this.offset = 0;
    this.entries = [];
  }

  async #write(buf) {
    this.offset += buf.length;
    if (!this.out.write(buf)) await new Promise((resolve) => this.out.once('drain', resolve));
  }

  async add(name, data, { compress = true } = {}) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const packed = compress ? zlib.deflateRawSync(data) : data;
    const method = compress ? 8 : 0;
    const { time, date } = dosDateTime();
    const header = Buffer.alloc(30);
    header.writeUInt32LE(SIG_LOCAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAG_UTF8, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    this.entries.push({ nameBuf, crc, method, time, date, csize: packed.length, usize: data.length, offset: this.offset });
    await this.#write(header);
    await this.#write(nameBuf);
    await this.#write(packed);
  }

  async finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(SIG_CENTRAL, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(FLAG_UTF8, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.csize, 20);
      c.writeUInt32LE(e.usize, 24);
      c.writeUInt16LE(e.nameBuf.length, 28);
      c.writeUInt32LE(e.offset, 42);
      await this.#write(c);
      await this.#write(e.nameBuf);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG_END, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    await this.#write(end);
    this.out.end();
  }
}

/**
 * Liest alle Einträge eines ZIP-Buffers. Liefert [{ name, read() }] – read() entpackt erst bei Bedarf.
 * maxEntryBytes schützt vor „ZIP-Bomben“.
 */
export function readZip(buf, { maxEntryBytes = 2 ** 31 } = {}) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Keine gültige ZIP-Datei');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('ZIP-Verzeichnis beschädigt');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // Ordner-Eintrag
    entries.push({
      name,
      size: usize,
      read() {
        if (usize > maxEntryBytes) throw new Error(`Eintrag zu groß: ${name}`);
        if (buf.readUInt32LE(local) !== SIG_LOCAL) throw new Error(`ZIP-Eintrag beschädigt: ${name}`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + csize);
        let data;
        if (method === 0) data = Buffer.from(raw);
        else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) });
        else throw new Error(`Nicht unterstützte Komprimierung in ${name}`);
        if (data.length !== usize || zlib.crc32(data) !== crc) throw new Error(`Prüfsumme falsch: ${name}`);
        return data;
      },
    });
  }
  return entries;
}
