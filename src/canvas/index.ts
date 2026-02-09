/**
 * Canvas module — re-exports server, broker, and export utilities.
 */

export { CanvasBroker, startCanvasServer } from "./server.ts";
export type { CanvasServerOptions, CanvasServerResult, SnapshotResponse, ExportResponse } from "./server.ts";
export { composePDF, exportPDFToFile } from "./pdf-export.ts";
export type { PageImage } from "./pdf-export.ts";
export type { CanvasContext, BlurryShape, SimpleShape, PeripheralShapeCluster } from "./context.ts";
