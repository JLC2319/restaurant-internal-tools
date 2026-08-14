import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type {
  RichTextBlockNode,
  RichTextDoc,
  RichTextInlineNode,
  RichTextTextNode,
} from '@rit/shared';

/**
 * The rich-text reader: renders a validated rich-text document (see
 * `richTextDocSchema` in @rit/shared) straight to React elements.
 *
 * Never `dangerouslySetInnerHTML` — the document arrives as structured JSON
 * that only contains allow-listed nodes and marks, and this file maps each one
 * to a concrete element. The only attacker-influenced attribute that can come
 * out of here is a link href, which the schema already restricts to http(s)
 * and which is re-checked below anyway.
 */

function renderText(node: RichTextTextNode, key: string): ReactNode {
  let element: ReactNode = node.text;
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        element = <strong className="font-semibold text-steel-900">{element}</strong>;
        break;
      case 'italic':
        element = <em>{element}</em>;
        break;
      case 'underline':
        element = <u className="underline decoration-steel-400 underline-offset-2">{element}</u>;
        break;
      case 'strike':
        element = <s className="text-steel-600">{element}</s>;
        break;
      case 'link': {
        const href = mark.attrs.href;
        if (!/^https?:\/\//i.test(href)) break;
        element = (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ember-700 underline decoration-ember-300 underline-offset-2 transition-colors hover:text-ember-600"
          >
            {element}
          </a>
        );
        break;
      }
    }
  }
  return <Fragment key={key}>{element}</Fragment>;
}

function renderInline(content: RichTextInlineNode[] | undefined, keyBase: string): ReactNode[] {
  return (content ?? []).map((node, index) => {
    const key = `${keyBase}-${index}`;
    if (node.type === 'hardBreak') return <br key={key} />;
    return renderText(node, key);
  });
}

function renderBlocks(nodes: RichTextBlockNode[], keyBase: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyBase}-${index}`;
    switch (node.type) {
      case 'paragraph':
        // An empty paragraph is a deliberate blank line — keep it visible.
        if (!node.content || node.content.length === 0) {
          return (
            <p key={key}>
              <br />
            </p>
          );
        }
        return <p key={key}>{renderInline(node.content, key)}</p>;

      case 'heading': {
        const content = renderInline(node.content, key);
        // The page's h1 is the module title; in-content headings start at h2.
        // `first:pt-0` keeps a section that opens on a heading flush with the
        // top of the reading column.
        if (node.attrs.level === 1)
          return (
            <h2
              key={key}
              className="flex items-center gap-3 pt-4 text-xl font-bold tracking-tight text-steel-900 first:pt-0"
            >
              <span
                aria-hidden
                className="h-6 w-1 shrink-0 rounded-full bg-linear-to-b from-ember-400 to-ember-600"
              />
              {content}
            </h2>
          );
        if (node.attrs.level === 2)
          return (
            <h3 key={key} className="pt-3 text-lg font-bold text-steel-900 first:pt-0">
              {content}
            </h3>
          );
        return (
          <h4 key={key} className="pt-2 font-semibold text-steel-900 first:pt-0">
            {content}
          </h4>
        );
      }

      case 'bulletList':
        return (
          <ul key={key} className="list-disc space-y-2 pl-6 marker:text-ember-500">
            {node.content.map((item, itemIndex) => (
              <li key={itemIndex} className="space-y-1.5 pl-1">
                {renderBlocks(item.content, `${key}-i${itemIndex}`)}
              </li>
            ))}
          </ul>
        );

      case 'orderedList':
        return (
          <ol
            key={key}
            start={
              node.attrs?.start !== undefined && node.attrs.start !== 1
                ? node.attrs.start
                : undefined
            }
            className="list-decimal space-y-2 pl-6 marker:font-semibold marker:text-steel-500"
          >
            {node.content.map((item, itemIndex) => (
              <li key={itemIndex} className="space-y-1.5 pl-1">
                {renderBlocks(item.content, `${key}-i${itemIndex}`)}
              </li>
            ))}
          </ol>
        );

      case 'blockquote':
        return (
          <blockquote
            key={key}
            className="space-y-2 rounded-r-xl border-l-4 border-ember-300 bg-ember-50/60 py-3 pr-5 pl-5 text-steel-700 italic"
          >
            {renderBlocks(node.content, key)}
          </blockquote>
        );
    }
  });
}

/** Drops trailing blank paragraphs — the editor keeps one for the caret. */
function trimTrailingEmpty(nodes: RichTextBlockNode[]): RichTextBlockNode[] {
  let end = nodes.length;
  while (end > 0) {
    const node = nodes[end - 1];
    if (node.type === 'paragraph' && (!node.content || node.content.length === 0)) end -= 1;
    else break;
  }
  return nodes.slice(0, end);
}

export function RichText({ doc }: { doc: RichTextDoc }) {
  return (
    <div className="space-y-4 text-base leading-7 text-steel-800">
      {renderBlocks(trimTrailingEmpty(doc.content), 'b')}
    </div>
  );
}
