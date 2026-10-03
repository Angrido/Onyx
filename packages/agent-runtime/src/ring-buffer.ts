export class TextTail {
  private content = "";

  constructor(private readonly maxChars: number) {}

  append(text: string): void {
    this.content += text;
    if (this.content.length > this.maxChars) {
      this.content = this.content.slice(this.content.length - this.maxChars);
    }
  }

  toString(): string {
    return this.content;
  }
}
