import "server-only";
import { z } from "zod";

// API_SPECS §2.2 (output schemas) and §2.4 (response envelope), verbatim.

export const BBox = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
}).describe("Value location as fractions of page width/height, origin top-left");
export type BBox = z.infer<typeof BBox>;

export const AiValue = z.object({
  text: z.string().max(500).nullable()
    .describe("Exactly as printed, including separators, units and currency symbols. null if not on this page."),
  confidence: z.number().min(0).max(1)
    .describe("Probability that text is exactly what the document states for this field"),
  bbox: BBox.nullable(),
});
export type AiValue = z.infer<typeof AiValue>;

export const DetectedDocType = z.enum(["COMMERCIAL_INVOICE", "PACKING_LIST", "BILL_OF_LADING", "OTHER"]);
export const PageIssue = z.enum(["BLURRY", "SKEWED", "CUT_OFF", "HANDWRITTEN", "LOW_CONTRAST", "NON_ENGLISH", "BLANK"]);

const pageMeta = {
  detectedDocumentType: DetectedDocType,
  pageReadable: z.boolean(),
  pageIssues: z.array(PageIssue).max(7),
};

export const InvoicePageSchema = z.object({
  ...pageMeta,
  fields: z.object({
    supplierName: AiValue,  importerName: AiValue,  consigneeName: AiValue,
    invoiceNumber: AiValue, invoiceDate: AiValue,   currency: AiValue,
    incoterm: AiValue,      invoiceTotal: AiValue,  totalPackages: AiValue,
    grossWeight: AiValue,   netWeight: AiValue,     containerNumbers: AiValue,
  }),
  lineItems: z.array(z.object({
    description: AiValue, hsCode: AiValue, quantity: AiValue,
    unit: AiValue, unitPrice: AiValue, lineTotal: AiValue,
  })).max(100), // A-25
});

export const PackingListPageSchema = z.object({
  ...pageMeta,
  fields: z.object({
    supplierName: AiValue,  consigneeName: AiValue, invoiceNumber: AiValue,
    totalPackages: AiValue, grossWeight: AiValue,   netWeight: AiValue,
    containerNumbers: AiValue,
  }),
  lineItems: z.array(z.object({
    description: AiValue, quantity: AiValue, unit: AiValue,
  })).max(100),
});

export const BillOfLadingPageSchema = z.object({
  ...pageMeta,
  fields: z.object({
    blNumber: AiValue,       supplierName: AiValue,    consigneeName: AiValue,
    portOfLoading: AiValue,  portOfDischarge: AiValue, totalPackages: AiValue,
    grossWeight: AiValue,    netWeight: AiValue,       containerNumbers: AiValue,
  }),
});

export const PAGE_SCHEMAS = {
  INVOICE: InvoicePageSchema,
  PACKING_LIST: PackingListPageSchema,
  BILL_OF_LADING: BillOfLadingPageSchema,
} as const;
export type PageExtraction =
  | z.infer<typeof InvoicePageSchema>
  | z.infer<typeof PackingListPageSchema>
  | z.infer<typeof BillOfLadingPageSchema>;

export const ChatCompletion = z.object({
  id: z.string().optional(),
  model: z.string(),
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable(),
      reasoning_content: z.string().nullable().optional(),
    }),
    finish_reason: z.string().nullable(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number(), completion_tokens: z.number(), total_tokens: z.number(),
  }).partial().optional(),
});

type Json = { [key: string]: unknown };
const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "maxLength", "minLength", "maxItems", "minItems"];

/**
 * The JSON Schema sent to the model (API_SPECS §2.2): z.toJSONSchema, then every object closed with
 * additionalProperties: false and numeric/length bounds removed (constrained decoders may reject them; Zod still
 * enforces them after parsing). Descriptions stay.
 */
export function toModelJsonSchema(schema: z.ZodType): Json {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node === null || typeof node !== "object") return node;
    const out: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED.includes(key) || key === "$schema") continue;
      out[key] = strip(value);
    }
    if (out.type === "object") out.additionalProperties = false;
    return out;
  };
  return strip(z.toJSONSchema(schema)) as Json;
}
