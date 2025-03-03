import { Document } from 'llamaindex';

export class RecursiveJsonTransformer {
  private maxSize: number;
  private minSize: number;

  constructor({ maxSize = 2000, minSize }: { maxSize: number; minSize?: number }) {
    this.maxSize = maxSize;
    this.minSize = minSize ?? Math.max(maxSize - 200, 50);
  }

  private static jsonSize(data: Record<string, any>): number {
    const seen = new WeakSet();

    function getStringifiableData(obj: any): any {
      if (obj === null || typeof obj !== 'object') {
        return obj;
      }

      if (seen.has(obj)) {
        return '[Circular]';
      }

      seen.add(obj);

      if (Array.isArray(obj)) {
        const safeArray = [];
        for (const item of obj) {
          safeArray.push(getStringifiableData(item));
        }
        return safeArray;
      }

      const safeObj: Record<string, any> = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          safeObj[key] = getStringifiableData(obj[key]);
        }
      }
      return safeObj;
    }

    const stringifiable = getStringifiableData(data);
    return JSON.stringify(stringifiable).length;
  }

  /**
   * Transform JSON data while handling circular references
   */
  public transform(data: Record<string, any>): Record<string, any> {
    const size = RecursiveJsonTransformer.jsonSize(data);

    const seen = new WeakSet();

    function createSafeCopy(obj: any): any {
      if (obj === null || typeof obj !== 'object') {
        return obj;
      }

      if (seen.has(obj)) {
        return '[Circular]';
      }

      seen.add(obj);

      if (Array.isArray(obj)) {
        return obj.map(item => createSafeCopy(item));
      }

      const copy: Record<string, any> = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          copy[key] = createSafeCopy(obj[key]);
        }
      }
      return copy;
    }

    return {
      size,
      data: createSafeCopy(data),
    };
  }

  /**
   * Set a value in a nested dictionary based on the given path
   */
  private static setNestedDict(d: Record<string, any>, path: string[], value: any): void {
    let current = d;
    for (const key of path.slice(0, -1)) {
      current[key] = current[key] || {};
      current = current[key];
    }
    current[path[path.length - 1]!] = value;
  }

  /**
   * Convert lists in the JSON structure to dictionaries with index-based keys
   */
  private listToDictPreprocessing(data: any): any {
    if (data && typeof data === 'object') {
      if (Array.isArray(data)) {
        return Object.fromEntries(data.map((item, index) => [String(index), this.listToDictPreprocessing(item)]));
      }
      return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, this.listToDictPreprocessing(v)]));
    }
    return data;
  }

  /**
   * Split json into maximum size dictionaries while preserving structure
   */
  private jsonSplit({
    data,
    currentPath = [],
    chunks = [{}],
    depth = 0,
    maxDepth = 100,
  }: {
    data: Record<string, any>;
    currentPath?: string[];
    chunks?: Record<string, any>[];
    depth?: number;
    maxDepth?: number;
  }): Record<string, any>[] {
    if (!data || typeof data !== 'object') {
      return chunks;
    }

    if (depth > maxDepth) {
      console.warn(`Maximum depth of ${maxDepth} exceeded, flattening remaining structure`);
      RecursiveJsonTransformer.setNestedDict(chunks[chunks.length - 1] || {}, currentPath, data);
      return chunks;
    }

    for (const [key, value] of Object.entries(data)) {
      const currentChunk = chunks[chunks.length - 1] || {};

      if (typeof value === 'object') {
        // Handle nested objects
        let currentNestedChunk = {};

        // Try to group fields together
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
          if (typeof nestedValue === 'object') {
            // Recursively handle deeper nested structures
            const subChunks = this.jsonSplit({
              data: { [nestedKey]: nestedValue },
              currentPath: [...currentPath, key],
              chunks: [{}],
              depth: depth + 1,
              maxDepth,
            });
            chunks.push(...subChunks);
            continue;
          }

          // Try adding the field to current nested chunk
          const testChunk = { ...currentNestedChunk, [nestedKey]: nestedValue };
          const testSize = RecursiveJsonTransformer.jsonSize({ [key]: testChunk });

          if (testSize <= this.maxSize) {
            // Field fits, add it to current nested chunk
            currentNestedChunk = testChunk;
          } else {
            // Field doesn't fit, save current chunk and start new one
            if (Object.keys(currentNestedChunk).length > 0) {
              const newChunk = {};
              RecursiveJsonTransformer.setNestedDict(newChunk, [key], currentNestedChunk);
              chunks.push(newChunk);
              currentNestedChunk = {};
            }

            // Handle the current field
            if (
              typeof nestedValue === 'string' &&
              RecursiveJsonTransformer.jsonSize({ [nestedKey]: nestedValue }) > this.maxSize
            ) {
              // Split long strings
              const stringChunks = this.splitLongString(nestedKey, nestedValue);
              stringChunks.forEach(chunk => {
                const splitChunk = {};
                RecursiveJsonTransformer.setNestedDict(splitChunk, [key], { [nestedKey]: chunk });
                chunks.push(splitChunk);
              });
            } else {
              currentNestedChunk = { [nestedKey]: nestedValue };
            }
          }
        }

        // Add any remaining nested data
        if (Object.keys(currentNestedChunk).length > 0) {
          const newChunk = {};
          RecursiveJsonTransformer.setNestedDict(newChunk, [key], currentNestedChunk);
          chunks.push(newChunk);
        }
      } else {
        // Handle primitive values
        const valueSize = RecursiveJsonTransformer.jsonSize({ [key]: value });
        if (valueSize > this.maxSize && typeof value === 'string') {
          // Split long strings
          const stringChunks = this.splitLongString(key, value);
          stringChunks.forEach(chunk => {
            const newChunk = {};
            RecursiveJsonTransformer.setNestedDict(newChunk, currentPath, { [key]: chunk });
            chunks.push(newChunk);
          });
        } else {
          // Try to add to current chunk
          const totalSize = RecursiveJsonTransformer.jsonSize({
            ...currentChunk,
            [key]: value,
          });

          if (totalSize <= this.maxSize) {
            RecursiveJsonTransformer.setNestedDict(currentChunk, [key], value);
          } else {
            const newChunk = {};
            RecursiveJsonTransformer.setNestedDict(newChunk, currentPath, { [key]: value });
            chunks.push(newChunk);
          }
        }
      }
    }

    return chunks.filter(chunk => Object.keys(chunk).length > 0);
  }

  private splitLongString(key: string, value: string): string[] {
    const chunks: string[] = [];
    let remaining = value;

    while (remaining.length > 0) {
      const overhead = JSON.stringify({ [key]: '' }).length - 2;
      let chunkSize = this.maxSize - overhead;

      let chunk = remaining.slice(0, chunkSize);
      if (remaining.length > chunkSize) {
        const lastSpace = chunk.lastIndexOf(' ');
        if (lastSpace > chunkSize * 0.7) {
          chunk = chunk.slice(0, lastSpace);
        }
      }

      chunks.push(chunk);
      remaining = remaining.slice(chunk.length).trim();
    }

    return chunks;
  }

  /**
   * Splits JSON into a list of JSON chunks
   */
  splitJson({
    jsonData,
    convertLists = false,
  }: {
    jsonData: Record<string, any>;
    convertLists?: boolean;
  }): Record<string, any>[] {
    const processedData = convertLists ? this.listToDictPreprocessing(jsonData) : jsonData;

    const chunks = this.jsonSplit({ data: processedData });

    if (Object.keys(chunks[chunks.length - 1] || {}).length === 0) {
      chunks.pop();
    }

    return chunks;
  }

  private escapeNonAscii(obj: any): any {
    if (typeof obj === 'string') {
      return obj.replace(/[\u0080-\uffff]/g, char => {
        return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
      });
    }

    if (typeof obj === 'object' && obj !== null) {
      return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, this.escapeNonAscii(value)]));
    }

    return obj;
  }
  /**
   * Splits JSON into a list of JSON formatted strings
   */
  splitText({
    jsonData,
    convertLists = false,
    ensureAscii = true,
  }: {
    jsonData: Record<string, any>;
    convertLists?: boolean;
    ensureAscii?: boolean;
  }): string[] {
    const chunks = this.splitJson({ jsonData, convertLists });

    if (ensureAscii) {
      const escapedChunks = chunks.map(chunk => this.escapeNonAscii(chunk));
      return escapedChunks.map(chunk => JSON.stringify(chunk));
    }

    return chunks.map(chunk => JSON.stringify(chunk));
  }

  /**
   * Create documents from a list of json objects
   */
  createDocuments({
    texts,
    convertLists = false,
    ensureAscii = true,
    metadatas,
  }: {
    texts: string[];
    convertLists?: boolean;
    ensureAscii?: boolean;
    metadatas?: Record<string, any>[];
  }): Document[] {
    const _metadatas = metadatas || Array(texts.length).fill({});
    const documents: Document[] = [];

    texts.forEach((text, i) => {
      const chunks = this.splitText({ jsonData: JSON.parse(text), convertLists, ensureAscii });
      chunks.forEach(chunk => {
        const metadata = { ...(_metadatas[i] || {}) };
        documents.push(
          new Document({
            text: chunk,
            metadata,
          }),
        );
      });
    });

    return documents;
  }

  transformDocuments({
    ensureAscii,
    documents,
    convertLists,
  }: {
    ensureAscii?: boolean;
    convertLists?: boolean;
    documents: Document[];
  }): Document[] {
    const texts: string[] = [];
    const metadatas: Record<string, any>[] = [];

    for (const doc of documents) {
      texts.push(doc.text);
      metadatas.push(doc.metadata);
    }

    return this.createDocuments({
      texts,
      metadatas,

      ensureAscii,
      convertLists,
    });
  }
}
