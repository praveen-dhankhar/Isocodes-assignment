import type { DocType, HeaderFieldKey, LineFieldKey } from "@/domain/fields";

// API_SPECS §7.1: the single source of sample content. Every value is what the document PRINTS (the model must read
// it back exactly); ground truth is derived from it with the domain normalisers. All companies, addresses and numbers
// are invented (A-13) except the brief's SHP-24811/24812 cells. SHP-24811…24816 must match
// src/domain/checks/__fixtures__/snapshots.ts — generate-samples refuses to write if they drift.

export type Variant = "digital" | "scan" | "scan-skewed" | "scan-unreadable-page" | "bilingual";

export interface Party {
  name: string;
  address: string[];
}

export interface SampleDocument {
  docType: DocType;
  variant: Variant;
  header: Partial<Record<HeaderFieldKey, string>>;
  lines: Array<Partial<Record<LineFieldKey, string>>>;
  /** Header fields printed on page 2 (SHP-24818's packing list is the only two-page document). */
  page2?: HeaderFieldKey[];
  /** Hand-authored confidences: "grossWeight" or "line2.unitPrice". Others get a per-variant default. */
  confidence?: Record<string, number>;
  /**
   * Hand-authored misreads: what the fixture's "model" returns instead of the printed text, same keys as
   * `confidence`. Truth stays the printed text, so these become real corrections in the seeded history (M8.4).
   */
  misread?: Record<string, string>;
}

export interface SampleShipment {
  ref: string;
  title: string;
  supplier: Party & { country: string };
  importer: Party;
  documents: SampleDocument[];
  /** Slots the seed uploads; SHP-24819 starts with the invoice only. */
  uploaded: DocType[];
}

const ALL: DocType[] = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"];

const IMPORTERS = {
  P: { name: "Company P", address: ["Plot 12, Chakan MIDC Phase II", "Pune 410501, Maharashtra, India"] },
  Q: { name: "Company Q", address: ["Gala 7, Rahnal Logistics Park", "Bhiwandi 421302, Maharashtra, India"] },
  R: { name: "Company R", address: ["Shed 44, Sanand GIDC", "Ahmedabad 382110, Gujarat, India"] },
} satisfies Record<string, Party>;

const supplier = (name: string, country: string, ...address: string[]) => ({ name, country, address });

export const SAMPLES: SampleShipment[] = [
  {
    ref: "SHP-24811",
    title: "Weight mismatch (from brief)",
    supplier: supplier("Company B", "CN", "No. 18 Jiangdong Road, Yinzhou District", "Ningbo 315100, Zhejiang, China"),
    importer: IMPORTERS.P,
    uploaded: ALL,
    documents: [
      {
        docType: "INVOICE",
        variant: "digital",
        header: {
          supplierName: "Company B", importerName: "Company P", consigneeName: "Company P",
          invoiceNumber: "CB-2026-1187", invoiceDate: "14/10/2026", currency: "USD", incoterm: "FOB Ningbo",
          invoiceTotal: "16,320.00", totalPackages: "240 CTNS", grossWeight: "3,120.00 KGS", netWeight: "2,880.00 KGS",
          containerNumbers: "XZQU4821171",
        },
        lines: [{ description: "LED panel light 40W", hsCode: "9405.42.90", quantity: "2,400", unit: "PCS", unitPrice: "6.80", lineTotal: "16,320.00" }],
      },
      {
        docType: "PACKING_LIST",
        variant: "digital",
        header: {
          supplierName: "Company B", consigneeName: "Company P", invoiceNumber: "CB-2026-1187", totalPackages: "240 CTNS",
          grossWeight: "3,165.00 KGS", netWeight: "2,880.00 KGS", containerNumbers: "XZQU4821171",
        },
        lines: [{ description: "LED panel light 40W", quantity: "2,400", unit: "PCS" }],
        confidence: { netWeight: 0.81 },
      },
      {
        docType: "BILL_OF_LADING",
        variant: "digital",
        header: {
          blNumber: "BLNGB2610447", supplierName: "Company B", consigneeName: "Company P", portOfLoading: "Ningbo",
          portOfDischarge: "Nhava Sheva", totalPackages: "240 CARTONS", grossWeight: "3,165.000 KGS", containerNumbers: "XZQU4821171",
        },
        lines: [],
      },
    ],
  },
  {
    ref: "SHP-24812",
    title: "European number format (from brief)",
    supplier: supplier("Company C", "SE", "Hamngatan 21", "411 06 Gothenburg, Sweden"),
    importer: IMPORTERS.Q,
    uploaded: ALL,
    documents: [
      {
        docType: "INVOICE",
        variant: "digital",
        header: {
          supplierName: "Company C", importerName: "Company Q", consigneeName: "Company Q",
          invoiceNumber: "CC-2026-0412", invoiceDate: "2026-10-09", currency: "EUR", incoterm: "FCA Gothenburg",
          invoiceTotal: "7.650,00", totalPackages: "6 pallets", grossWeight: "1.460,00 kg", netWeight: "1.340,00 kg",
          containerNumbers: "KQZU2073199",
        },
        lines: [{ description: "Steel ball valve DN50", hsCode: "8481.80.30", quantity: "180", unit: "PCS", unitPrice: "42,50", lineTotal: "7.650,00" }],
      },
      {
        docType: "PACKING_LIST",
        variant: "digital",
        header: {
          supplierName: "Company C", consigneeName: "Company Q", invoiceNumber: "CC-2026-0412", totalPackages: "6 PALLETS",
          grossWeight: "1,460.00 KG", netWeight: "1,340.00 KG", containerNumbers: "KQZU2073199",
        },
        lines: [{ description: "Steel ball valve DN50", quantity: "180", unit: "PCS" }],
      },
      {
        docType: "BILL_OF_LADING",
        variant: "digital",
        header: {
          blNumber: "BLGOT2610118", supplierName: "Company C", consigneeName: "Company Q", portOfLoading: "Gothenburg",
          portOfDischarge: "Nhava Sheva", totalPackages: "6 PALLETS", grossWeight: "1,460.000 KGS", netWeight: "1,340.000 KGS",
          containerNumbers: "KQZU2073199",
        },
        lines: [],
      },
    ],
  },
  {
    ref: "SHP-24813",
    title: "Two lines, clean",
    supplier: supplier("Company D", "DE", "Industriestraße 9", "20539 Hamburg, Germany"),
    importer: IMPORTERS.R,
    uploaded: ALL,
    documents: [
      {
        docType: "INVOICE",
        variant: "digital",
        header: {
          supplierName: "Company D", importerName: "Company R", consigneeName: "Company R",
          invoiceNumber: "DE-2026-3307", invoiceDate: "2 Oct 2026", currency: "EUR", incoterm: "FOB Hamburg",
          invoiceTotal: "5,100.00", totalPackages: "8 CASES", grossWeight: "620.00 KG", netWeight: "560.00 KG",
          containerNumbers: "ZXKU7310049",
        },
        lines: [
          { description: "Hydraulic gear pump 16cc", hsCode: "8413.60.10", quantity: "40", unit: "PCS", unitPrice: "118.00", lineTotal: "4,720.00" },
          { description: "Pump seal kit", hsCode: "8484.90.00", quantity: "40", unit: "SETS", unitPrice: "9.50", lineTotal: "380.00" },
        ],
        misread: { "line1.hsCode": "8413.60.1" }, // a dropped digit
      },
      {
        docType: "PACKING_LIST",
        variant: "digital",
        header: {
          supplierName: "Company D", consigneeName: "Company R", invoiceNumber: "DE-2026-3307", totalPackages: "8 CASES",
          grossWeight: "620.00 KG", netWeight: "560.00 KG", containerNumbers: "ZXKU7310049",
        },
        lines: [
          { description: "Hydraulic gear pump 16cc", quantity: "40", unit: "PCS" },
          { description: "Pump seal kit", quantity: "40", unit: "SET" },
        ],
        misread: { netWeight: "580.00 KG" },
        confidence: { netWeight: 0.83 },
      },
      {
        docType: "BILL_OF_LADING",
        variant: "scan",
        header: {
          blNumber: "BLHAM2610231", supplierName: "Company D", consigneeName: "Company R", portOfLoading: "Hamburg",
          portOfDischarge: "Nhava Sheva", totalPackages: "8 CASES", grossWeight: "620.00 KGS", containerNumbers: "ZXKU7310049",
        },
        lines: [],
      },
    ],
  },
  {
    ref: "SHP-24814",
    title: "Line quantity mismatch",
    supplier: supplier("Company E", "TW", "No. 66, Chenggong 2nd Road, Qianzhen District", "Kaohsiung 806, Taiwan"),
    importer: IMPORTERS.P,
    uploaded: ALL,
    documents: [
      {
        docType: "INVOICE",
        variant: "digital",
        header: {
          supplierName: "Company E", importerName: "Company P", consigneeName: "Company P",
          invoiceNumber: "TW-2026-0881", invoiceDate: "2026/10/11", currency: "USD", incoterm: "FOB Kaohsiung",
          invoiceTotal: "10,620.00", totalPackages: "35 CTNS", grossWeight: "512.00 KGS", netWeight: "468.00 KGS",
          containerNumbers: "QZXU5609317",
        },
        lines: [
          { description: "BLE 5.3 module", hsCode: "8517.62.90", quantity: "5,000", unit: "PCS", unitPrice: "1.92", lineTotal: "9,600.00" },
          { description: "USB-C receptacle 16P", hsCode: "8536.90.90", quantity: "12,000", unit: "PCS", unitPrice: "0.085", lineTotal: "1,020.00" },
        ],
        confidence: { "line2.unitPrice": 0.79 },
      },
      {
        docType: "PACKING_LIST",
        variant: "digital",
        header: {
          supplierName: "Company E", consigneeName: "Company P", invoiceNumber: "TW-2026-0881", totalPackages: "35 CTNS",
          grossWeight: "512.00 KGS", netWeight: "468.00 KGS", containerNumbers: "QZXU5609317",
        },
        lines: [
          { description: "BLE 5.3 module", quantity: "5,000", unit: "PCS" },
          { description: "USB-C receptacle 16P", quantity: "10,000", unit: "PCS" },
        ],
      },
      {
        docType: "BILL_OF_LADING",
        variant: "digital",
        header: {
          blNumber: "BLKHH2610552", supplierName: "Company E", consigneeName: "Company P", portOfLoading: "Kaohsiung",
          portOfDischarge: "Nhava Sheva", totalPackages: "35 CARTONS", grossWeight: "512.00 KGS", containerNumbers: "QZXU5609317",
        },
        lines: [],
      },
    ],
  },
  {
    ref: "SHP-24815",
    title: "Phone-scanned B/L, bad container check digit",
    supplier: supplier("Company F", "TH", "88/9 Moo 3, Sukhumvit Road", "Laem Chabang, Chonburi 20230, Thailand"),
    importer: IMPORTERS.Q,
    uploaded: ALL,
    documents: [
      {
        docType: "INVOICE",
        variant: "digital",
        header: {
          supplierName: "Company F", importerName: "Company Q", consigneeName: "Company Q",
          invoiceNumber: "TH-2026-1290", invoiceDate: "07/10/2026", currency: "USD", incoterm: "FOB Laem Chabang",
          invoiceTotal: "7,200.00", totalPackages: "60 CTNS", grossWeight: "1,830.00 KGS", netWeight: "1,710.00 KGS",
        },
        lines: [{ description: "Rubber timing belt", hsCode: "4010.39.00", quantity: "3,000", unit: "PCS", unitPrice: "2.40", lineTotal: "7,200.00" }],
      },
      {
        docType: "PACKING_LIST",
        variant: "digital",
        header: {
          supplierName: "Company F", consigneeName: "Company Q", invoiceNumber: "TH-2026-1290", totalPackages: "60 CTNS",
          grossWeight: "1,830.00 KGS", netWeight: "1,710.00 KGS", containerNumbers: "XZQU4821253",
        },
        lines: [{ description: "Rubber timing belt", quantity: "3,000", unit: "PCS" }],
      },
      {
        docType: "BILL_OF_LADING",
        variant: "scan-skewed",
        header: {
          blNumber: "BLLCH2610090", supplierName: "Company F", consigneeName: "Company Q", portOfLoading: "Laem Chabang",
          portOfDischarge: "Nhava Sheva", totalPackages: "60 CARTONS", grossWeight: "1,830.000 KGS", containerNumbers: "XZQU4821254",
        },
        lines: [],
        confidence: { containerNumbers: 0.62 },
      },
    ],
  },
  {
    ref: "SHP-24816",
    title: "Weights in pounds, US dates",
    supplier: supplier("Company G", "US", "4100 Westheimer Road, Suite 200", "Houston, TX 77027, USA"),
    importer: IMPORTERS.R,
    uploaded: ALL,
    documents: [
      {
        docType: "INVOICE",
        variant: "digital",
        header: {
          supplierName: "Company G", importerName: "Company R", consigneeName: "Company R",
          invoiceNumber: "US-2026-4471", invoiceDate: "10/03/2026", currency: "USD", incoterm: "FCA Chicago",
          invoiceTotal: "8,550.00", totalPackages: "50 CTNS",
        },
        lines: [{ description: "Stainless fastener assortment", hsCode: "7318.15.00", quantity: "600", unit: "KITS", unitPrice: "14.25", lineTotal: "8,550.00" }],
        misread: { invoiceNumber: "US-2026-4477" }, // 1 read as 7
        confidence: { invoiceNumber: 0.84 },
      },
      {
        docType: "PACKING_LIST",
        variant: "digital",
        header: {
          supplierName: "Company G", consigneeName: "Company R", invoiceNumber: "US-2026-4471", totalPackages: "50 CTNS",
          grossWeight: "2,204.62 LBS", netWeight: "1,984.16 LBS", containerNumbers: "KQZU2074003",
        },
        lines: [{ description: "Stainless fastener assortment", quantity: "600", unit: "KITS" }],
      },
      {
        docType: "BILL_OF_LADING",
        variant: "digital",
        header: {
          blNumber: "BLHOU2610377", supplierName: "Company G", consigneeName: "Company R", portOfLoading: "Houston",
          portOfDischarge: "Nhava Sheva", totalPackages: "50 CARTONS", grossWeight: "1,000 KGS", containerNumbers: "KQZU2074003",
        },
        lines: [],
      },
    ],
  },
  {
    ref: "SHP-24817",
    title: "Bilingual Chinese/English invoice",
    supplier: supplier("Company B", "CN", "No. 18 Jiangdong Road, Yinzhou District", "Ningbo 315100, Zhejiang, China"),
    importer: IMPORTERS.P,
    uploaded: ALL,
    documents: [
      {
        docType: "INVOICE",
        variant: "bilingual",
        header: {
          supplierName: "Company B", importerName: "Company P", consigneeName: "Company P",
          invoiceNumber: "CB-2026-1302", invoiceDate: "20/10/2026", currency: "USD", incoterm: "FOB Ningbo",
          invoiceTotal: "9,040.00", totalPackages: "40 CTNS", grossWeight: "1,280.00 KGS", netWeight: "1,120.00 KGS",
          containerNumbers: "ZXKU7311220",
        },
        lines: [{ description: "Solar charge controller 40A / 太阳能控制器", hsCode: "8504.40.90", quantity: "800", unit: "PCS", unitPrice: "11.30", lineTotal: "9,040.00" }],
        confidence: { "line1.description": 0.78, "line1.unitPrice": 0.82 },
        misread: { "line1.unitPrice": "11.80" }, // 3 read as 8
      },
      {
        docType: "PACKING_LIST",
        variant: "digital",
        header: {
          supplierName: "Company B", consigneeName: "Company P", invoiceNumber: "CB-2026-1302", totalPackages: "40 CTNS",
          grossWeight: "1,280.00 KGS", netWeight: "1,120.00 KGS", containerNumbers: "ZXKU7311220",
        },
        lines: [{ description: "Solar charge controller 40A", quantity: "800", unit: "PCS" }],
      },
      {
        docType: "BILL_OF_LADING",
        variant: "digital",
        header: {
          blNumber: "BLNGB2610733", supplierName: "Company B", consigneeName: "Company P", portOfLoading: "Ningbo",
          portOfDischarge: "Nhava Sheva", totalPackages: "40 CARTONS", grossWeight: "1,280.00 KGS", containerNumbers: "ZXKU7311220",
        },
        lines: [],
      },
    ],
  },
  {
    ref: "SHP-24818",
    title: "Yen invoice, unreadable packing-list page",
    supplier: supplier("Company H", "JP", "2-14 Shinko, Naka-ku", "Yokohama 231-0001, Japan"),
    importer: IMPORTERS.Q,
    uploaded: ALL,
    documents: [
      {
        docType: "INVOICE",
        variant: "digital",
        header: {
          supplierName: "Company H", importerName: "Company Q", consigneeName: "Company Q",
          invoiceNumber: "H-2026-0577", invoiceDate: "2026/10/05", currency: "JPY", incoterm: "FOB Yokohama",
          invoiceTotal: "1,050,000", totalPackages: "25 CTNS", grossWeight: "720.00 KGS", netWeight: "650.00 KGS",
          containerNumbers: "QZXU5610072",
        },
        lines: [{ description: "Bearing 6205-2RS", hsCode: "8482.10.11", quantity: "5,000", unit: "PCS", unitPrice: "210", lineTotal: "1,050,000" }],
      },
      {
        docType: "PACKING_LIST",
        variant: "scan-unreadable-page",
        header: {
          supplierName: "Company H", consigneeName: "Company Q", invoiceNumber: "H-2026-0577", totalPackages: "25 CTNS",
          grossWeight: "720.00 KGS", netWeight: "650.00 KGS", containerNumbers: "QZXU5610072",
        },
        lines: [{ description: "Bearing 6205-2RS", quantity: "5,000", unit: "PCS" }],
        page2: ["totalPackages", "grossWeight", "netWeight", "containerNumbers"],
      },
      {
        docType: "BILL_OF_LADING",
        variant: "digital",
        header: {
          blNumber: "BLYOK2610208", supplierName: "Company H", consigneeName: "Company Q", portOfLoading: "Yokohama",
          portOfDischarge: "Nhava Sheva", totalPackages: "25 CARTONS", grossWeight: "720.00 KGS", containerNumbers: "QZXU5610072",
        },
        lines: [],
      },
    ],
  },
  {
    ref: "SHP-24819",
    title: "Invoice only (draft)",
    supplier: supplier("Company C", "SE", "Hamngatan 21", "411 06 Gothenburg, Sweden"),
    importer: IMPORTERS.R,
    uploaded: ["INVOICE"],
    documents: [
      {
        docType: "INVOICE",
        variant: "digital",
        header: {
          supplierName: "Company C", importerName: "Company R", consigneeName: "Company R",
          invoiceNumber: "CC-2026-0455", invoiceDate: "22.10.2026", currency: "EUR", incoterm: "FCA Gothenburg",
          invoiceTotal: "4.260,00", totalPackages: "3 pallets", grossWeight: "640,00 kg", netWeight: "590,00 kg",
          containerNumbers: "XZQU9002130",
        },
        lines: [{ description: "Steel ball valve DN80", hsCode: "8481.80.30", quantity: "60", unit: "PCS", unitPrice: "71,00", lineTotal: "4.260,00" }],
      },
      {
        docType: "PACKING_LIST",
        variant: "digital",
        header: {
          supplierName: "Company C", consigneeName: "Company R", invoiceNumber: "CC-2026-0455", totalPackages: "3 PALLETS",
          grossWeight: "640.00 KG", netWeight: "590.00 KG", containerNumbers: "XZQU9002130",
        },
        lines: [{ description: "Steel ball valve DN80", quantity: "60", unit: "PCS" }],
      },
      {
        docType: "BILL_OF_LADING",
        variant: "digital",
        header: {
          blNumber: "BLGOT2610140", supplierName: "Company C", consigneeName: "Company R", portOfLoading: "Gothenburg",
          portOfDischarge: "Nhava Sheva", totalPackages: "3 PALLETS", grossWeight: "640.00 KGS", containerNumbers: "XZQU9002130",
        },
        lines: [],
      },
    ],
  },
];

export const SAMPLE_REFS = SAMPLES.map((s) => s.ref);
