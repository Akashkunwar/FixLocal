import { useEffect, useState } from "react";
import { useToast } from "./Toast";
import { removeTextTemplate, upsertTextTemplate, type TextTemplate } from "../lib/textTemplates";

type Props = {
  title: string;
  description: string;
  noun: string;
  idPrefix: string;
  /** What's currently saved on the account (already merged with starters). */
  value: TextTemplate[];
  defaults: TextTemplate[];
  placeholder: string;
  onSave: (next: TextTemplate[]) => Promise<unknown>;
};

/** Create, edit, remove and reset one kind of saved text template. Every change saves to the account. */
export function TemplateEditor({ title, description, noun, idPrefix, value, defaults, placeholder, onSave }: Props) {
  const { success, error } = useToast();
  const [list, setList] = useState(value);
  const [editId, setEditId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setList(value), [value]);

  function resetDraft() {
    setEditId(null);
    setLabel("");
    setBody("");
  }

  async function persist(next: TextTemplate[], message: string) {
    setBusy(true);
    try {
      await onSave(next);
      setList(next);
      success(message);
      return true;
    } catch (e) {
      error((e as Error).message || "Couldn't save templates");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const next = upsertTextTemplate(list, { id: editId, label: label || `Custom ${noun}`, body }, idPrefix);
    if (next === list) return;
    if (await persist(next, editId ? `${cap(noun)} template updated` : `${cap(noun)} template saved`)) resetDraft();
  }

  const slug = idPrefix.replace(/[^a-z]/gi, "");
  return (
    <section className="card space-y-4 p-5 sm:p-6" aria-labelledby={`${slug}-title`}>
      <div>
        <h2 id={`${slug}-title`} className="font-semibold text-slate-900">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="space-y-3 rounded-xl bg-brand-50/50 p-3 ring-1 ring-brand-100">
        <p className="text-xs font-medium text-slate-700">{editId ? `Edit ${noun} template` : `New ${noun} template`}</p>
        <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
          <input
            className="input py-1.5! text-sm"
            placeholder="Label"
            maxLength={80}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label={`${cap(noun)} template label`}
          />
          <textarea
            className="input min-h-[64px] text-sm"
            placeholder={placeholder}
            maxLength={500}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label={`${cap(noun)} template body`}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary btn-sm" disabled={busy || !body.trim()} onClick={submit}>
            {editId ? "Save changes" : "Add template"}
          </button>
          {editId && (
            <button type="button" className="btn-ghost btn-sm" onClick={resetDraft}>
              Cancel edit
            </button>
          )}
        </div>
      </div>
      <ul className="space-y-2">
        {list.map((tpl) => {
          const isDefault = defaults.some((d) => d.id === tpl.id);
          return (
            <li
              key={tpl.id}
              className={`flex items-start justify-between gap-3 rounded-xl px-3 py-2 ring-1 ${
                editId === tpl.id ? "bg-brand-50 ring-brand-200" : "bg-slate-50 ring-slate-200"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {tpl.label}
                  <span
                    className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-normal ${
                      isDefault ? "bg-slate-200/80 text-slate-600" : "bg-brand-100 text-brand-800"
                    }`}
                  >
                    {isDefault ? "default" : "custom"}
                  </span>
                </p>
                <p className="line-clamp-2 text-xs text-slate-500">{tpl.body}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setEditId(tpl.id);
                    setLabel(tpl.label);
                    setBody(tpl.body);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm text-rose-700"
                  disabled={busy}
                  onClick={async () => {
                    const next = removeTextTemplate(list, tpl.id);
                    // An empty account list falls back to the starters, as on first use.
                    if (await persist(next, "Template removed")) {
                      if (!next.length) setList(defaults);
                      if (editId === tpl.id) resetDraft();
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={busy}
        onClick={async () => {
          if (await persist(defaults, `Restored default ${noun} templates`)) resetDraft();
        }}
      >
        Reset to defaults
      </button>
    </section>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
