"use client";
import * as React from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { LinkButton } from "@/components/ui/button";
import { ActionForm, SaveButton } from "@/app/(app)/settings/_components/action-form";
import { saveArticle } from "./actions";
import { MarkdownLite } from "./markdown-lite";

export function ArticleForm({
  article,
  categories,
}: {
  article?: { id: number; title: string; category: string; body: string };
  categories: string[];
}) {
  const [body, setBody] = React.useState(article?.body ?? "");
  const [preview, setPreview] = React.useState(false);
  return (
    <ActionForm action={saveArticle}>
      {article && <input type="hidden" name="id" value={article.id} />}
      <Card>
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
            <Field label="Title" htmlFor="k-title" required>
              <Input id="k-title" name="title" defaultValue={article?.title} required placeholder="e.g. How we price yard signs" />
            </Field>
            <Field label="Category" htmlFor="k-cat" required hint="Pick one or type a new one.">
              <Input id="k-cat" name="category" list="k-cats" defaultValue={article?.category ?? ""} required placeholder="e.g. Pricing" />
              <datalist id="k-cats">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="k-body" className="text-sm font-medium text-slate-700">
                Article
              </label>
              <button type="button" onClick={() => setPreview((p) => !p)} className="text-sm font-medium text-brand-700 hover:underline">
                {preview ? "Back to writing" : "Preview"}
              </button>
            </div>
            <Textarea
              id="k-body"
              name="body"
              rows={18}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={preview ? "hidden" : "font-[inherit] text-base"}
              placeholder={"Write it the way you'd explain it to a new employee.\n\n- Start a line with a dash for a bullet list\n1. Start with 1. for steps\n**Two stars** around words makes them bold"}
            />
            {preview && (
              <div className="min-h-40 rounded-lg border border-slate-200 bg-slate-50 px-5 py-4">
                {body.trim() ? <MarkdownLite body={body} /> : <p className="text-slate-500">Nothing to preview yet.</p>}
              </div>
            )}
            <p className="mt-1.5 text-xs text-slate-500">
              Tips: a blank line starts a new paragraph · “- ” makes a bullet · “1. ” makes a numbered step · **bold**
            </p>
          </div>
        </CardBody>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <LinkButton href={article ? `/knowledge/${article.id}` : "/knowledge"}>Cancel</LinkButton>
          <SaveButton>{article ? "Save article" : "Publish article"}</SaveButton>
        </div>
      </Card>
    </ActionForm>
  );
}
