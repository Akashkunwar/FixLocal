import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guards Hindi coverage (ux MED 9): visible English must go through t()/tf()/plural(), not sit in
 * JSX as raw text, a literal text prop, or a literal JSX child expression.
 */
const SOURCES = import.meta.glob<string>(["../**/*.tsx", "!../**/*.test.tsx", "!../test/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

// Legal bodies are English by design (the English text is binding); their headings use t().
const SKIP_FILES = [/(^|\/)LegalPages\.tsx$/, /(^|\/)i18n\.tsx$/]; // i18n.tsx: the language names in the toggle
// Names that read the same in both languages.
const NEUTRAL = /^(FixLocal|WhatsApp|SMS|UPI|GSTIN|PDF|AMC|SLA|CCTV|INR|OK|ID|404)$/;
const TEXT_PROPS = new Set([
  "title", "subtitle", "description", "label", "hint", "eyebrow", "emptyText", "heading", "confirmLabel",
  "cancelLabel", "message", "actionLabel", "aria-label", "placeholder", "alt", "aria-description",
]);

const words = (s: string) => s.replace(/\{\w+\}/g, "").trim();
// Two lowercase letters in a row: words, not codes like a sample GSTIN.
const isEnglish = (s: string) => /[a-z]{2,}/.test(words(s)) && !NEUTRAL.test(words(s).replace(/[^\w]/g, ""));

function findRawText(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const at = (n: ts.Node, what: string) =>
    hits.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${what.slice(0, 70)}`);
  const literal = (e: ts.Expression | undefined, where: string): void => {
    if (!e) return;
    if (ts.isParenthesizedExpression(e)) return literal(e.expression, where);
    if (ts.isConditionalExpression(e)) {
      literal(e.whenTrue, where);
      literal(e.whenFalse, where);
      return;
    }
    if (ts.isBinaryExpression(e)) {
      const k = e.operatorToken.kind;
      if (k === ts.SyntaxKind.AmpersandAmpersandToken) return literal(e.right, where);
      if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.PlusToken) {
        literal(e.left, where);
        literal(e.right, where);
      }
      return;
    }
    if ((ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && isEnglish(e.text)) at(e, `${where}: ${e.text}`);
    if (ts.isTemplateExpression(e)) {
      const text = [e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(" ");
      if (isEnglish(text)) at(e, `${where}: \`${text}\``);
    }
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && isEnglish(n.getText())) at(n, `text: ${n.getText().trim()}`);
    if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) literal(n.expression, "child");
    if (ts.isJsxAttribute(n) && TEXT_PROPS.has(n.name.getText()) && n.initializer) {
      if (ts.isStringLiteral(n.initializer) && isEnglish(n.initializer.text)) at(n, `${n.name.getText()}="${n.initializer.text}"`);
      else if (ts.isJsxExpression(n.initializer)) literal(n.initializer.expression, n.name.getText());
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe("no raw English in JSX", () => {
  it("finds a raw string (self-check)", () => {
    expect(findRawText("x.tsx", `const a = <p title="Hello there">Save now {"Go back"}</p>;`)).toHaveLength(3);
    expect(findRawText("x.tsx", `const a = <p title={t("Hello")}>{t("Save")} FixLocal</p>;`)).toEqual([]);
  });

  it("every .tsx file routes visible text through t()", () => {
    const hits: string[] = [];
    for (const [file, src] of Object.entries(SOURCES)) {
      if (SKIP_FILES.some((re) => re.test(file))) continue;
      hits.push(...findRawText(file, src));
    }
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(hits).toEqual([]);
  });
});
