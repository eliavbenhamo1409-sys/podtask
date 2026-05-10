/**
 * Loads a student submission file from Supabase Storage and prepares it for
 * the OpenAI Responses API:
 *
 * - PDFs are uploaded to OpenAI Files API and returned as `{ kind: "file" }`
 *   so the caller can reference them as an `input_file` part.
 * - DOCX is unzipped in-process (`<w:t>` text extraction from
 *   `word/document.xml`) and returned as `{ kind: "text" }`.
 * - TXT is read directly as UTF-8 and returned as `{ kind: "text" }`.
 *
 * The downloaded text is capped at ~30k characters to keep token usage
 * predictable; truncation is reported back so the caller can mention it in
 * logs / diagnostics.
 */

// @ts-expect-error -- esm.sh URL resolved at runtime in Edge Functions.
import JSZip from "https://esm.sh/jszip@3.10.1";
import { uploadFileToOpenAI } from "./openai.ts";

interface SbStorageClient {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{
        data: Blob | null;
        error: { message: string } | null;
      }>;
    };
  };
}

const ASSIGNMENT_BUCKET = "assignment-files";
const MAX_TEXT_CHARS = 30000;

export type LoadedDocument =
  | {
      kind: "file";
      fileId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    }
  | {
      kind: "text";
      text: string;
      truncated: boolean;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    };

export interface SubmissionFileRef {
  filePath: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
}

export class DocumentLoadError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
    this.name = "DocumentLoadError";
  }
}

/**
 * Returns either a `file_id` (PDF) or extracted plain text (DOCX/TXT) for
 * the submission. Throws a `DocumentLoadError` with a stable code on every
 * known failure path so the caller can surface a meaningful status to the
 * user.
 */
export async function loadSubmissionDocument(
  sb: SbStorageClient,
  submission: SubmissionFileRef,
): Promise<LoadedDocument> {
  if (!submission.filePath) {
    throw new DocumentLoadError("submission_file_missing");
  }
  const filename = submission.originalFilename ?? "submission";
  const mime = (submission.mimeType ?? guessMimeFromName(filename)).toLowerCase();

  const { data: blob, error } = await sb.storage
    .from(ASSIGNMENT_BUCKET)
    .download(submission.filePath);
  if (error || !blob) {
    throw new DocumentLoadError(
      `storage_download_failed:${error?.message ?? "no_blob"}`,
      502,
    );
  }

  const sizeBytes = submission.fileSizeBytes ?? blob.size;

  if (mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    const pdfBlob = blob.type === "application/pdf"
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: "application/pdf" });
    const fileId = await uploadFileToOpenAI(pdfBlob, filename);
    return {
      kind: "file",
      fileId,
      filename,
      mimeType: "application/pdf",
      sizeBytes,
    };
  }

  if (
    mime === "text/plain" ||
    filename.toLowerCase().endsWith(".txt") ||
    filename.toLowerCase().endsWith(".md")
  ) {
    const raw = await blob.text();
    return finalizeText(raw, filename, mime, sizeBytes);
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword" ||
    filename.toLowerCase().endsWith(".docx") ||
    filename.toLowerCase().endsWith(".doc")
  ) {
    const text = await extractDocxText(blob);
    return finalizeText(text, filename, mime, sizeBytes);
  }

  throw new DocumentLoadError(`unsupported_mime:${mime}`);
}

function finalizeText(
  raw: string,
  filename: string,
  mime: string,
  sizeBytes: number,
): LoadedDocument {
  const cleaned = raw.replace(/\r\n/g, "\n").trim();
  if (cleaned.length === 0) {
    throw new DocumentLoadError("empty_document");
  }
  const truncated = cleaned.length > MAX_TEXT_CHARS;
  const text = truncated ? cleaned.slice(0, MAX_TEXT_CHARS) : cleaned;
  return {
    kind: "text",
    text,
    truncated,
    filename,
    mimeType: mime,
    sizeBytes,
  };
}

function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  return "application/octet-stream";
}

interface JSZipFile {
  async(type: "string"): Promise<string>;
}
interface JSZipInstance {
  file(path: string): JSZipFile | null;
}
interface JSZipStatic {
  loadAsync(data: ArrayBuffer): Promise<JSZipInstance>;
}

/**
 * Extracts plain text from a DOCX blob. DOCX is a ZIP that contains
 * `word/document.xml`; the human-readable runs live inside `<w:t>` tags
 * (with optional namespace prefix). We grab them in order, intersperse
 * paragraph breaks for `<w:p>`, and return the concatenated string.
 */
async function extractDocxText(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const zip = await (JSZip as unknown as JSZipStatic).loadAsync(buf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new DocumentLoadError("docx_missing_document_xml");
  }
  const xml = await docFile.async("string");

  const out: string[] = [];
  const paragraphRe = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  const runRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  for (const para of xml.match(paragraphRe) ?? []) {
    const parts: string[] = [];
    runRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = runRe.exec(para)) !== null) {
      parts.push(decodeXmlEntities(m[1]));
    }
    const line = parts.join("");
    if (line.trim().length > 0) out.push(line);
  }
  return out.join("\n");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
