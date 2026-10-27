/**
 * Minimal ZIP-skrivare som strömmar (ingen komprimering, "stored"). Underlag är redan komprimerade
 * (PDF, JPEG, PNG), så inget går förlorat, och bara en fil åt gången ligger i minnet.
 * Stöder inte ZIP64: högst 65 535 filer och 4 GB totalt.
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export type ZipEntry = { name: string; data: Uint8Array; date?: Date };

export const ZIP_MAX_ENTRIES = 65000;

/** Bygger en ReadableStream med ZIP-innehållet. `entries` hämtas en i taget. */
export function zipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  const it = entries[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await it.next();
      if (done) {
        let size = 0;
        for (const c of central) {
          controller.enqueue(c);
          size += c.length;
        }
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, count, true);
        end.setUint16(10, count, true);
        end.setUint32(12, size, true);
        end.setUint32(16, offset, true);
        controller.enqueue(new Uint8Array(end.buffer));
        controller.close();
        return;
      }
      const name = enc.encode(value.name);
      const { time, date } = dosTime(value.date ?? new Date());
      const crc = crc32(value.data);
      const size = value.data.length;

      // Lokal filhuvud (crc och storlek finns med direkt, eftersom filen redan är läst)
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true); // UTF-8-filnamn
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      controller.enqueue(new Uint8Array(lh.buffer));
      controller.enqueue(name);
      controller.enqueue(value.data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      const rec = new Uint8Array(46 + name.length);
      rec.set(new Uint8Array(ch.buffer), 0);
      rec.set(name, 46);
      central.push(rec);

      offset += 30 + name.length + size;
      count++;
      if (offset > 0xffffffff) throw new Error("ZIP-filen blir för stor (över 4 GB). Dela upp exporten.");
    },
  });
}
