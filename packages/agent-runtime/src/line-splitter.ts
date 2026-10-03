export const DEFAULT_MAX_LINE_LENGTH = 8 * 1024 * 1024;

export interface LineSplitterHandlers {
  onLine(line: string): void;
  onOverflow(discardedLength: number): void;
}

export class LineSplitter {
  private buffer = "";
  private discarding = false;
  private discardedLength = 0;

  constructor(
    private readonly handlers: LineSplitterHandlers,
    private readonly maxLineLength = DEFAULT_MAX_LINE_LENGTH,
  ) {}

  push(chunk: string): void {
    let start = 0;
    let newline = chunk.indexOf("\n", start);
    while (newline !== -1) {
      this.consume(chunk.slice(start, newline), true);
      start = newline + 1;
      newline = chunk.indexOf("\n", start);
    }
    if (start < chunk.length) this.consume(chunk.slice(start), false);
  }

  flush(): void {
    if (this.discarding) {
      this.handlers.onOverflow(this.discardedLength);
    } else if (this.buffer.length > 0) {
      this.emit(this.buffer);
    }
    this.reset();
  }

  private consume(segment: string, terminated: boolean): void {
    if (this.discarding) {
      this.discardedLength += segment.length;
    } else if (this.buffer.length + segment.length > this.maxLineLength) {
      this.discarding = true;
      this.discardedLength = this.buffer.length + segment.length;
      this.buffer = "";
    } else {
      this.buffer += segment;
    }

    if (!terminated) return;
    if (this.discarding) {
      this.handlers.onOverflow(this.discardedLength);
    } else {
      this.emit(this.buffer);
    }
    this.reset();
  }

  private emit(line: string): void {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (trimmed.trim().length > 0) this.handlers.onLine(trimmed);
  }

  private reset(): void {
    this.buffer = "";
    this.discarding = false;
    this.discardedLength = 0;
  }
}
