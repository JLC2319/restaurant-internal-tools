import type {
  RichTextBlockNode,
  RichTextDoc,
  RichTextInlineNode,
  RichTextTextNode,
} from '@rit/shared';
import type { ReactNode } from 'react';
import { Linking, Text, View } from 'react-native';

/**
 * The rich-text reader, native edition: renders a validated rich-text
 * document (see `richTextDocSchema` in @rit/shared) straight to Text/View.
 * The document only contains allow-listed nodes and marks; the one
 * attacker-influenced attribute is a link href, which the schema restricts
 * to http(s) and which is re-checked here anyway before Linking opens it.
 */

function renderText(node: RichTextTextNode, key: string): ReactNode {
  let className = 'font-sans';
  let strike = false;
  let underline = false;
  let href: string | null = null;

  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        className = 'font-sans-semibold text-steel-900';
        break;
      case 'italic':
        className += ' italic';
        break;
      case 'underline':
        underline = true;
        break;
      case 'strike':
        strike = true;
        break;
      case 'link':
        if (/^https?:\/\//i.test(mark.attrs.href)) href = mark.attrs.href;
        break;
    }
  }

  if (strike || underline) {
    className +=
      strike && underline ? ' line-through underline' : strike ? ' line-through' : ' underline';
  }
  if (href) className += ' font-sans-medium text-ember-700 underline';

  return (
    <Text
      key={key}
      className={className}
      onPress={href ? () => void Linking.openURL(href) : undefined}
    >
      {node.text}
    </Text>
  );
}

function renderInline(content: RichTextInlineNode[] | undefined, keyBase: string): ReactNode[] {
  return (content ?? []).map((node, index) => {
    const key = `${keyBase}-${index}`;
    if (node.type === 'hardBreak') return <Text key={key}>{'\n'}</Text>;
    return renderText(node, key);
  });
}

function ListItem({ marker, children }: { marker: ReactNode; children: ReactNode }) {
  return (
    <View className="flex-row gap-2.5">
      <View className="w-6 items-end pt-0.5">{marker}</View>
      <View className="flex-1 gap-1.5">{children}</View>
    </View>
  );
}

function renderBlocks(nodes: RichTextBlockNode[], keyBase: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyBase}-${index}`;
    switch (node.type) {
      case 'paragraph':
        // An empty paragraph is a deliberate blank line — keep it visible.
        if (!node.content || node.content.length === 0) {
          return <View key={key} className="h-4" />;
        }
        return (
          <Text key={key} className="font-sans text-base leading-7 text-steel-800">
            {renderInline(node.content, key)}
          </Text>
        );

      case 'heading': {
        const content = renderInline(node.content, key);
        // The screen's title is the module title; in-content headings start
        // one visual level down, same as the web reader.
        if (node.attrs.level === 1)
          return (
            <View key={key} className="flex-row items-center gap-3 pt-4">
              <View className="h-6 w-1 rounded-full bg-ember-500" />
              <Text className="flex-1 font-sans-bold text-xl tracking-tight text-steel-900">
                {content}
              </Text>
            </View>
          );
        if (node.attrs.level === 2)
          return (
            <Text key={key} className="pt-3 font-sans-bold text-lg text-steel-900">
              {content}
            </Text>
          );
        return (
          <Text key={key} className="pt-2 font-sans-semibold text-base text-steel-900">
            {content}
          </Text>
        );
      }

      case 'bulletList':
        return (
          <View key={key} className="gap-2">
            {node.content.map((item, itemIndex) => (
              <ListItem
                key={itemIndex}
                marker={<Text className="font-sans-bold text-base text-ember-500">•</Text>}
              >
                {renderBlocks(item.content, `${key}-i${itemIndex}`)}
              </ListItem>
            ))}
          </View>
        );

      case 'orderedList': {
        const start = node.attrs?.start ?? 1;
        return (
          <View key={key} className="gap-2">
            {node.content.map((item, itemIndex) => (
              <ListItem
                key={itemIndex}
                marker={
                  <Text className="font-sans-semibold text-sm leading-6 text-steel-500">
                    {start + itemIndex}.
                  </Text>
                }
              >
                {renderBlocks(item.content, `${key}-i${itemIndex}`)}
              </ListItem>
            ))}
          </View>
        );
      }

      case 'blockquote':
        return (
          <View
            key={key}
            className="gap-2 rounded-r-xl border-l-4 border-ember-300 bg-ember-50 py-3 pl-4 pr-5"
          >
            {renderBlocks(node.content, key)}
          </View>
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
  return <View className="gap-4">{renderBlocks(trimTrailingEmpty(doc.content), 'b')}</View>;
}
