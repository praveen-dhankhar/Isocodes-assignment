// Active ISO 4217 currencies; fund, precious-metal and test codes (XAU, XTS, XXX…) are left out.
const ISO_4217 = new Set(
  (
    "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD " +
    "CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD " +
    "GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT " +
    "LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR " +
    "NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD " +
    "SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF " +
    "XCD XCG XOF XPF YER ZAR ZMW ZWG ZWL"
  ).split(" "),
);

// "$" alone is USD (PRD §7); a letter prefix names another dollar. Unknown prefix → invalid.
const DOLLARS: Record<string, string> = {
  US: "USD", HK: "HKD", S: "SGD", SG: "SGD", A: "AUD", AU: "AUD", C: "CAD", CA: "CAD", NZ: "NZD",
};
const SYMBOLS: Array<[string, string]> = [["€", "EUR"], ["£", "GBP"], ["₹", "INR"]];

/** ISO 4217 code, or null when unknown (PRD §7). `supplierCountry` (alpha-2) decides what "¥" means. */
export function parseCurrency(text: string, supplierCountry: string | null): string | null {
  const t = text.toUpperCase();
  if (/\bRMB\b/.test(t)) return "CNY";
  if (/\bUS\s*DOLLARS?\b/.test(t)) return "USD";
  if (/\bEUROS?\b/.test(t)) return "EUR";

  const code = t.match(/\b[A-Z]{3}\b/g)?.find((word) => ISO_4217.has(word));
  if (code) return code;

  const dollar = /(?:\b([A-Z]{1,2}))?\$/.exec(t);
  if (dollar) return dollar[1] === undefined ? "USD" : (DOLLARS[dollar[1]] ?? null);

  if (/[¥￥]/.test(t)) return supplierCountry === "CN" ? "CNY" : supplierCountry === "JP" ? "JPY" : null;

  return SYMBOLS.find(([symbol]) => t.includes(symbol))?.[1] ?? null;
}
