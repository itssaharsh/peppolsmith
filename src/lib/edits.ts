// Applies the model's SEARCH/REPLACE edit blocks to the previous map.py. Fix attempts send only the changed
// lines, which keeps each fix to a few hundred tokens instead of a whole new file.
export type EditResult = { code: string; applied: number; failed: string[] };

const BLOCK = /<{7} SEARCH\r?\n([\s\S]*?)\r?\n={7}\r?\n([\s\S]*?)\r?\n?>{7} REPLACE/g;

export function hasEditBlocks(text: string): boolean {
  return /<{7} SEARCH/.test(text) && />{7} REPLACE/.test(text);
}

export function applyEdits(previous: string, reply: string): EditResult {
  let code = previous;
  let applied = 0;
  const failed: string[] = [];
  for (const m of reply.matchAll(BLOCK)) {
    const [, search, replace] = m;
    if (search.length === 0) {
      failed.push("(empty SEARCH)");
      continue;
    }
    const at = code.indexOf(search);
    if (at >= 0) {
      code = code.slice(0, at) + replace + code.slice(at + search.length);
      applied++;
      continue;
    }
    // tolerate trailing-whitespace differences line by line
    const loose = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n");
    const looseCode = loose(code);
    const i = looseCode.indexOf(loose(search));
    if (i >= 0) {
      code = looseCode.slice(0, i) + replace + looseCode.slice(i + loose(search).length);
      applied++;
    } else {
      failed.push(search.split("\n")[0].slice(0, 80));
    }
  }
  return { code: code.endsWith("\n") ? code : code + "\n", applied, failed };
}
