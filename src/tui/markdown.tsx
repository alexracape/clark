/**
 * Simple markdown renderer for Ink.
 *
 * Supports common markdown features:
 * - Headings (# ## ###)
 * - Bold (**text**)
 * - Italic (*text* or _text_)
 * - Inline code (`code`)
 * - Code blocks (```code```)
 * - Lists (- item or * item)
 * - Links ([text](url))
 */

import React from "react";
import { Box, Text } from "ink";
import { hex } from "./theme.ts";

export interface MarkdownProps {
  children: string;
}

type ParsedLine =
  | { type: "heading"; level: number; content: string }
  | { type: "list"; indent: number; content: string }
  | { type: "code"; content: string }
  | { type: "text"; content: string };

/**
 * Parse markdown text into structured lines
 */
function parseMarkdown(text: string): ParsedLine[] {
  const lines = text.split("\n");
  const parsed: ParsedLine[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Code block detection
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        // End of code block
        parsed.push({
          type: "code",
          content: codeBlockContent.join("\n"),
        });
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        // Start of code block
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Heading detection
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      parsed.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      continue;
    }

    // List detection
    const listMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (listMatch && listMatch[1] !== undefined && listMatch[3]) {
      parsed.push({
        type: "list",
        indent: listMatch[1].length,
        content: listMatch[3],
      });
      continue;
    }

    // Regular text
    parsed.push({
      type: "text",
      content: line,
    });
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBlockContent.length > 0) {
    parsed.push({
      type: "code",
      content: codeBlockContent.join("\n"),
    });
  }

  return parsed;
}

/**
 * Apply inline markdown formatting (bold, italic, code, links)
 */
function formatInline(text: string): string {
  let result = text;

  // Normalize simple markdown markup to plain text.
  // Keep this ANSI-free so Ink controls styling and wrapping safely.
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1");
  result = result.replace(/_([^_]+)_/g, "$1");
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  return result;
}

/**
 * Render a parsed markdown line
 */
function renderLine(line: ParsedLine, index: number): React.ReactElement {
  const key = `line-${index}`;

  switch (line.type) {
    case "heading": {
      const level = line.level;
      const prefix = "#".repeat(level);
      const content = formatInline(line.content);
      return (
        <Box key={key} marginY={level === 1 ? 1 : 0}>
          <Text color={hex.lampGreen} bold>{prefix}</Text>
          <Text> </Text>
          <Text color={hex.messageText} bold wrap="wrap">{content}</Text>
        </Box>
      );
    }

    case "list": {
      const indent = " ".repeat(line.indent + 2);
      const content = formatInline(line.content);
      return (
        <Box key={key}>
          <Text>{indent}</Text>
          <Text color={hex.lampGreen}>•</Text>
          <Text> </Text>
          <Text color={hex.messageText} wrap="wrap">{content}</Text>
        </Box>
      );
    }

    case "code": {
      const codeLines = line.content.split("\n");
      return (
        <Box key={key} flexDirection="column" marginY={1} paddingLeft={2} borderStyle="single" borderColor={hex.divider}>
          {codeLines.map((codeLine, i) => (
            <Text key={i} color={hex.brass} wrap="wrap">{codeLine}</Text>
          ))}
        </Box>
      );
    }

    case "text": {
      if (line.content.trim() === "") {
        return <Text key={key}> </Text>;
      }
      const content = formatInline(line.content);
      return (
        <Box key={key}>
          <Text color={hex.messageText} wrap="wrap">{content}</Text>
        </Box>
      );
    }
  }
}

/**
 * Markdown component for Ink
 */
export function Markdown({ children }: MarkdownProps) {
  try {
    const parsed = parseMarkdown(children);
    return (
      <Box flexDirection="column">
        {parsed.map((line, i) => renderLine(line, i))}
      </Box>
    );
  } catch (error) {
    // Fallback: render as plain text if markdown parsing fails
    return <Text color={hex.messageText} wrap="wrap">{children}</Text>;
  }
}
