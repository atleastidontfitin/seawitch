const VERBS = new Map<string, string>([
  ['Excludes', 'exclude'],
  ['Overrides', 'override'],
  ['Supports', 'support'],
  ['Requires', 'require'],
  ['Allows', 'allow'],
  ['Replaces', 'replace'],
]);

export function questionFromName(name: string, vocabulary: ReadonlyMap<string, string>): string | undefined {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
    return undefined;
  }
  const tokens = splitCamel(name);
  const isIndexes = indexesOf(tokens, 'Is');
  const verbIndexes = tokens.flatMap((token, index) => (VERBS.has(token) ? [index] : []));
  let subject: string[] | undefined;
  let complement: string[] | undefined;
  let verb: string | undefined;
  if (isIndexes.length === 1 && verbIndexes.length === 0) {
    const at = isIndexes[0] ?? -1;
    if (at > 0 && at < tokens.length - 1) {
      subject = tokens.slice(0, at);
      complement = tokens.slice(at + 1);
    }
  } else if (isIndexes.length === 0 && verbIndexes.length === 1) {
    const at = verbIndexes[0] ?? -1;
    const token = tokens[at];
    if (token && at > 0 && at < tokens.length - 1) {
      subject = tokens.slice(0, at);
      complement = tokens.slice(at + 1);
      verb = VERBS.get(token);
    }
  }
  if (!subject || !complement || (verbIndexes.length === 1 && !verb)) {
    return undefined;
  }
  const subjectPhrase = phraseFor(subject, vocabulary);
  const complementPhrase = phraseFor(complement, vocabulary);
  if (!subjectPhrase || !complementPhrase) {
    return undefined;
  }
  const question = verb
    ? `Does ${subjectPhrase} ${verb} ${complementPhrase}?`
    : `Is ${subjectPhrase} ${complementPhrase}?`;
  if (!/^[A-Z]/.test(question) || question.indexOf('?') !== question.length - 1) {
    return undefined;
  }
  return question;
}

function phraseFor(tokens: string[], vocabulary: ReadonlyMap<string, string>): string | undefined {
  const texts = [...new Set(cover(tokens, vocabulary).map((pieces) => pieces.join(' ')))];
  if (texts.length !== 1 || !texts[0]) {
    return undefined;
  }
  return texts[0];
}

function cover(tokens: string[], vocabulary: ReadonlyMap<string, string>): string[][] {
  const memo = new Map<number, { score: number; covers: string[][] }>();
  const solve = (index: number): { score: number; covers: string[][] } => {
    const found = memo.get(index);
    if (found) {
      return found;
    }
    if (index >= tokens.length) {
      const done = { score: 0, covers: [[]] as string[][] };
      memo.set(index, done);
      return done;
    }
    let score = -1;
    let covers: string[][] = [];
    const consider = (length: number, phrase: string, matched: number): void => {
      const rest = solve(index + length);
      const total = matched + rest.score;
      const next = rest.covers.map((pieces) => [phrase, ...pieces]);
      if (total > score) {
        score = total;
        covers = next;
        return;
      }
      if (total === score) {
        covers.push(...next);
      }
    };
    for (let length = tokens.length - index; length >= 1; length -= 1) {
      const phrase = vocabulary.get(`path:${camelJoin(tokens.slice(index, index + length))}`);
      if (phrase) {
        consider(length, phrase, length);
      }
    }
    const token = tokens[index] ?? '';
    consider(1, spelled(token), 0);
    const result = { score, covers };
    memo.set(index, result);
    return result;
  };
  return solve(0).covers;
}

function splitCamel(name: string): string[] {
  return name.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).filter((token) => token.length > 0);
}

function camelJoin(tokens: string[]): string {
  return tokens
    .map((token, index) => {
      if (token.length > 1 && token === token.toUpperCase()) {
        return token;
      }
      const first = index === 0 ? token.charAt(0).toLowerCase() : token.charAt(0).toUpperCase();
      return `${first}${token.slice(1)}`;
    })
    .join('');
}

function spelled(token: string): string {
  if (token.length > 1 && token === token.toUpperCase()) {
    return token;
  }
  return token.toLowerCase();
}

function indexesOf(tokens: string[], token: string): number[] {
  return tokens.flatMap((item, index) => (item === token ? [index] : []));
}
