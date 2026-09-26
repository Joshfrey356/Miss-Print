import * as React from "react";

/**
 * Tiny, safe renderer for knowledge articles. Supports:
 *   blank-line paragraphs · "- " / "* " bullet lists · "1." numbered lists · "## " headings · **bold**
 * Produces React elements only (no raw HTML), so article text can never inject markup.
 */
function inline(text: string, keyBase: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={`${keyBase}-${i}`} className="font-semibold text-slate-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <React.Fragment key={`${keyBase}-${i}`}>{part}</React.Fragment>
    ),
  );
}

type Block =
  | { type: "p"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[]; start: number }
  | { type: "h"; text: string };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,4}\s+(.*)$/;

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(HEADING))) {
      flush();
      blocks.push({ type: "h", text: m[1]! });
    } else if ((m = line.match(BULLET))) {
      if (cur?.type !== "ul") {
        flush();
        cur = { type: "ul", items: [] };
      }
      cur.items.push(m[1]!);
    } else if ((m = line.match(NUMBER))) {
      if (cur?.type !== "ol") {
        flush();
        cur = { type: "ol", items: [], start: Number(m[1]) };
      }
      cur.items.push(m[2]!);
    } else if (cur && cur.type !== "p" && /^\s{2,}\S/.test(raw)) {
      // Indented continuation of the last list item.
      const items = cur.type === "ul" || cur.type === "ol" ? cur.items : [];
      items[items.length - 1] += " " + line.trim();
    } else {
      if (cur?.type !== "p") {
        flush();
        cur = { type: "p", lines: [] };
      }
      cur.lines.push(line.trim());
    }
  }
  flush();
  return blocks;
}

export function MarkdownLite({ body }: { body: string }) {
  const blocks = parseBlocks(body);
  return (
    <div className="space-y-4 text-[17px] leading-relaxed text-slate-800">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.type) {
          case "h":
            return (
              <h2 key={k} className="pt-2 text-lg font-semibold text-slate-900">
                {inline(b.text, k)}
              </h2>
            );
          case "ul":
            return (
              <ul key={k} className="list-disc space-y-1.5 pl-6 marker:text-slate-400">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${k}-${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={k} start={b.start} className="list-decimal space-y-1.5 pl-6 marker:font-medium marker:text-slate-500">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${k}-${j}`)}</li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={k}>
                {b.lines.map((l, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(l, `${k}-${j}`)}
                  </React.Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}

/** Plain-text preview for lists and search results (markers removed). */
export function plainPreview(body: string, max = 160) {
  const s = body
    .replace(/\*\*/g, "")
    .replace(/^\s*(?:[-*•]|\d+[.)]|#{1,4})\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
