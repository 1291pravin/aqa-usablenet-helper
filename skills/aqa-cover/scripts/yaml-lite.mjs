// Minimal YAML parser — handles the simple journey YAML format used by this skill.
// No external deps. Supports: scalars, sequences (- item), nested maps, inline objects.
// Does NOT support: anchors, tags, multi-line strings, flow sequences beyond simple cases.

export function parse(text) {
  const lines = text.split('\n');
  return parseBlock(lines, 0, -1).value;
}

function parseBlock(lines, start, parentIndent) {
  const result = {};
  let i = start;
  let currentArray = null;
  let currentKey = null;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) { i++; continue; }

    const indent = line.length - trimmed.length;
    if (indent <= parentIndent && i > start) break;

    // Array item
    if (trimmed.startsWith('- ')) {
      const itemContent = trimmed.slice(2).trim();
      if (!currentArray) currentArray = [];

      // Check if it's an inline object like { type: goto, url: ... }
      if (itemContent.startsWith('{') && itemContent.endsWith('}')) {
        currentArray.push(parseInlineObject(itemContent));
        i++;
        continue;
      }

      // Check if it's a key: value on the same line
      const colonIdx = itemContent.indexOf(':');
      if (colonIdx > 0 && !itemContent.startsWith('"') && !itemContent.startsWith("'")) {
        // It's an object item — parse the sub-block
        const subObj = {};
        const key = itemContent.slice(0, colonIdx).trim();
        const val = itemContent.slice(colonIdx + 1).trim();
        subObj[key] = parseValue(val);

        // Check for continuation lines at deeper indent than the `- ` marker
        let j = i + 1;
        while (j < lines.length) {
          const subLine = lines[j];
          const subTrimmed = subLine.trimStart();
          if (!subTrimmed || subTrimmed.startsWith('#')) { j++; continue; }
          const subIndent = subLine.length - subTrimmed.length;
          if (subIndent <= indent) break;
          const subColon = subTrimmed.indexOf(':');
          if (subColon > 0) {
            const sk = subTrimmed.slice(0, subColon).trim();
            const sv = subTrimmed.slice(subColon + 1).trim();
            subObj[sk] = parseValue(sv);
          }
          j++;
        }
        currentArray.push(subObj);
        i = j;
        continue;
      }

      // Simple scalar
      currentArray.push(parseValue(itemContent));
      i++;
      continue;
    }

    // Key: value
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      // Flush any pending array
      if (currentArray && currentKey) {
        result[currentKey] = currentArray;
        currentArray = null;
      }

      const key = trimmed.slice(0, colonIdx).trim();
      const rawVal = trimmed.slice(colonIdx + 1).trim();

      if (rawVal === '' || rawVal === '|' || rawVal === '>') {
        // Check if next line starts a list or nested object
        const nextI = i + 1;
        if (nextI < lines.length) {
          const nextTrimmed = lines[nextI].trimStart();
          const nextIndent = lines[nextI].length - nextTrimmed.length;
          if (nextIndent > indent) {
            if (nextTrimmed.startsWith('- ')) {
              currentKey = key;
              currentArray = [];
              i++;
              continue;
            } else {
              // Nested object
              const sub = parseBlock(lines, nextI, indent);
              result[key] = sub.value;
              i = sub.nextLine;
              continue;
            }
          }
        }
        result[key] = '';
      } else if (rawVal.startsWith('{') && rawVal.endsWith('}')) {
        result[key] = parseInlineObject(rawVal);
      } else {
        result[key] = parseValue(rawVal);
      }
      currentKey = key;
      i++;
      continue;
    }

    i++;
  }

  // Flush pending array
  if (currentArray && currentKey) {
    result[currentKey] = currentArray;
  }

  return { value: result, nextLine: i };
}

function parseInlineObject(str) {
  const inner = str.slice(1, -1).trim();
  const obj = {};
  // Split on commas not inside quotes
  const parts = smartSplit(inner, ',');
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx > 0) {
      const k = part.slice(0, colonIdx).trim();
      const v = part.slice(colonIdx + 1).trim();
      obj[k] = parseValue(v);
    }
  }
  return obj;
}

function stripInlineComment(str) {
  let inQuote = false;
  let quoteChar = '';
  let braceDepth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = true; quoteChar = ch; continue; }
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    if (ch === '#' && braceDepth === 0 && (i === 0 || /\s/.test(str[i - 1]))) {
      return str.slice(0, i);
    }
  }
  return str;
}

function smartSplit(str, delimiter) {
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  let braceDepth = 0;

  for (const ch of str) {
    if (inQuote) {
      current += ch;
      if (ch === quoteChar) inQuote = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      current += ch;
      continue;
    }
    if (ch === '{') braceDepth++;
    if (ch === '}') braceDepth--;
    if (ch === delimiter && braceDepth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseValue(str) {
  if (str === '' || str === undefined) return '';

  // Strip trailing inline comment (` # ...`) when not inside quotes/braces.
  // A bare `#` at start-of-token is treated as comment; `#` mid-string is kept
  // (important for URL fragments like `?q=foo#section`).
  str = stripInlineComment(str).trim();

  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'null') return null;

  // Remove quotes
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return Number(str);
  }

  // Inline object
  if (str.startsWith('{') && str.endsWith('}')) {
    return parseInlineObject(str);
  }

  return str;
}
