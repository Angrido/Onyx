import { Fragment } from "react";
import { answerBlocks, type InlinePart } from "@/lib/insights";

function Inline({ parts }: { parts: InlinePart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "code" ? (
          <code key={index} className="rounded bg-surface-2 px-1 font-mono text-[12px]">
            {part.text}
          </code>
        ) : part.kind === "strong" ? (
          <strong key={index}>{part.text}</strong>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

export function AnswerText({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {answerBlocks(text).map((block, index) =>
        block.kind === "list" ? (
          <ul key={index} className="list-disc space-y-1 pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inline parts={item} />
              </li>
            ))}
          </ul>
        ) : block.kind === "note" ? (
          <p key={index} className="text-xs italic text-muted-foreground">
            <Inline parts={block.parts} />
          </p>
        ) : (
          <p key={index}>
            <Inline parts={block.parts} />
          </p>
        ),
      )}
    </div>
  );
}
