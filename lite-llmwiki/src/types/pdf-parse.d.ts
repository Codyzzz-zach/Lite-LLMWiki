declare module "pdf-parse/lib/pdf-parse.js" {
	interface PdfResult {
		numpages: number;
		numrender: number;
		info: Record<string, unknown>;
		metadata: Record<string, unknown>;
		text: string;
		version: string;
	}

	function pdfParse(dataBuffer: Buffer): Promise<PdfResult>;
	export default pdfParse;
}
