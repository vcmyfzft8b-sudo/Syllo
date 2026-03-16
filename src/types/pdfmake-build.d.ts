declare module "pdfmake/build/pdfmake" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";

  interface CreatedPdf {
    download: (defaultFileName?: string) => void;
  }

  interface PdfMakeStatic {
    vfs?: Record<string, string>;
    addVirtualFileSystem: (vfs: Record<string, string>) => void;
    createPdf: (documentDefinitions: TDocumentDefinitions) => CreatedPdf;
  }

  const pdfMake: PdfMakeStatic;
  export default pdfMake;
}

declare module "pdfmake/js/Printer" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";

  interface PdfKitDocument {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    end: () => void;
  }

  export default class PdfPrinter {
    constructor(
      fontDescriptors: Record<
        string,
        {
          normal: string;
          bold?: string;
          italics?: string;
          bolditalics?: string;
        }
      >,
      virtualfs?: Record<string, string>,
    );

    createPdfKitDocument(
      documentDefinitions: TDocumentDefinitions,
    ): Promise<PdfKitDocument>;
  }
}

declare module "pdfmake/build/vfs_fonts" {
  const pdfFonts: Record<string, string>;

  export default pdfFonts;
}
