declare module "pdfmake/build/pdfmake" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";

  interface CreatedPdf {
    download: (defaultFileName?: string) => void;
  }

  interface PdfMakeStatic {
    vfs?: Record<string, string>;
    createPdf: (documentDefinitions: TDocumentDefinitions) => CreatedPdf;
  }

  const pdfMake: PdfMakeStatic;
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const pdfFonts: {
    pdfMake?: { vfs: Record<string, string> };
    vfs?: Record<string, string>;
  };

  export default pdfFonts;
}
