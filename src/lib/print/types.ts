/**
 * The vocabulary of the pipeline, shared between server and browser.
 *
 * Deliberately free of secrets and of any `node:` import, because the review UI
 * is a client component and needs every one of these types. Anything that
 * touches the filesystem, an API key, or the network belongs in `lib/pipeline`
 * or `lib/shopify`, not here.
 */

export type SizeId = "A5" | "A4" | "A3" | "13x19";

export type Pt = { x: number; y: number };

/**
 * Normal = one sheet. Split3 = ONE artwork printed across three panels and
 * sold as a single product, so a size variant on a split poster means "three
 * panels at that size", not "one panel".
 */
export type PosterKind = "normal" | "split3";

/**
 * The store's four collections. These drive three things at once — the title
 * suffix, the Shopify collection, and the Drive folder — which is why the
 * batch picks one rather than each stage guessing.
 */
export type CategoryId = "marvel" | "dc" | "movies-tv" | "music";

/**
 * A rectangle in 0..1 space, origin top-left.
 *
 * Normalized rather than pixel coords on purpose: a crop chosen before the
 * upscale stage stays correct after it. Pixel coordinates would silently mean
 * something different once the master changed size, and the failure mode is a
 * crop that drifts off the subject with nothing obviously wrong.
 */
export type NormRect = { x: number; y: number; width: number; height: number };

export type JobStage =
  | "ingested"
  | "probed"
  | "upscaled"
  | "analyzed"
  | "cropped"
  | "mocked"
  | "approved"
  | "uploaded"
  | "published";

/**
 * Ordered so `STAGE_ORDER.indexOf(a) < STAGE_ORDER.indexOf(b)` is meaningful.
 * This ordering IS the resumability mechanism: a job records the highest stage
 * it completed, and the runner re-enters at the first one after it.
 */
export const STAGE_ORDER: readonly JobStage[] = [
  "ingested",
  "probed",
  "upscaled",
  "analyzed",
  "cropped",
  "mocked",
  "approved",
  "uploaded",
  "published",
] as const;

export function stageIndex(stage: JobStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/** True when `job.stage` has reached or passed `stage`. */
export function hasReached(current: JobStage, stage: JobStage): boolean {
  return stageIndex(current) >= stageIndex(stage);
}

export type JobStatus =
  | { kind: "idle" }
  | { kind: "running"; stage: JobStage; startedAt: number }
  | { kind: "failed"; stage: JobStage; message: string; at: number }
  /** Parked until a human approves. The one hard gate in the pipeline. */
  | { kind: "needs-review" }
  | { kind: "done" };

export type ProbeResult = {
  width: number;
  height: number;
  format: string;
  bytes: number;
  /**
   * True when the source was below the print floor and we resampled it up.
   * Surfaced as a warning badge — an upscale does not add detail it never had,
   * and pretending otherwise is how a soft print reaches a customer.
   */
  upscaled: boolean;
  /** Effective DPI at each size, given the master's real pixels. */
  dpiBySize: Record<SizeId, number>;
};

/**
 * The parts of a product title we generate.
 *
 * The full title is assembled by `formatTitle()` and never stored pre-joined:
 * the sequence number is resolved at publish time against the live catalogue,
 * so a stored string would have to be re-parsed and rewritten. Keeping the
 * parts separate makes that a field update instead of string surgery.
 *
 * There is no description here. Every product shares one static template — see
 * `print/description.ts`.
 */
export type AiMetadata = {
  /** Who or what this is: "Spider Man", "The Weeknd". */
  subject: string;
  /** Trailing detail for a specific album or storyline: "Star Boy". Usually null. */
  subtitle: string | null;
  /**
   * Assigned at PUBLISH time from live Shopify data, not when the poster is
   * analyzed — a number chosen an hour ago may have been taken since.
   */
  sequence: number | null;
  /** Chosen from the store's existing tag vocabulary, not invented. */
  tags: string[];
  altText: string;
  /**
   * Distinguishes a human's words from a model's guess, so the review UI can
   * highlight what still needs a look.
   */
  source: "gemini" | "manual" | "fallback";
};

export type FocalPoint = {
  /** The region that must survive cropping. Normalized 0..1. */
  subject: NormRect;
  /** Where the eye should land when the subject cannot fully fit. */
  anchor: Pt;
  confidence: number;
  source: "gemini" | "manual" | "fallback";
};

export type RenderedAsset = {
  sizeId: SizeId;
  /**
   * 1-based panel index for a split poster, null for a normal one. A split
   * product therefore carries 12 assets: four sizes times three panels.
   */
  panel: 1 | 2 | 3 | null;
  /** Relative to the job directory. Absolute paths break when the workspace moves. */
  relPath: string;
  width: number;
  height: number;
  bytes: number;
  dpi: number;
  /** Below the print floor — drives the warning badge. */
  lowRes: boolean;
  /** The crop actually used, so a re-render is reproducible and the editor can
   *  restore the handles exactly where they were left. */
  crop: NormRect;
  /** Content hash, so an already-uploaded file can be skipped on retry. */
  sha256: string;
};

export type RenderedMockup = {
  templateId: string;
  relPath: string;
  width: number;
  height: number;
};

/**
 * One image in the product's gallery, in display order.
 *
 * Discriminated because the three sources have genuinely different lifecycles:
 * a mockup is regenerated whenever the crop changes, a library image is
 * uploaded to Shopify once and referenced by every product forever, and a
 * one-off belongs to exactly this job.
 */
export type ProductImageRef =
  | { kind: "mockup"; templateId: string }
  | { kind: "library"; libraryId: string }
  | { kind: "oneoff"; relPath: string };

export type DriveRefs = {
  folderId: string;
  /** relPath → Drive file id. Presence means uploaded, so skip. */
  files: Record<string, string>;
};

export type ShopifyRefs = {
  productId: string;
  handle: string;
  variantIds: Partial<Record<SizeId, string>>;
  /** relPath → MediaImage GID, so a retry does not re-upload media. */
  mediaIds: Record<string, string>;
  publishedAt: number | null;
};

export type PosterJob = {
  id: string;
  batchId: string;
  /** Original filename — kept for the UI and for the Drive copy. */
  sourceName: string;
  sourceRelPath: string;
  /** Defaulted from the batch but overridable: a batch is usually all one kind,
   *  but not always. */
  kind: PosterKind;
  /** The highest stage completed. Everything at or before it is done. */
  stage: JobStage;
  status: JobStatus;
  probe: ProbeResult | null;
  metadata: AiMetadata | null;
  focal: FocalPoint | null;
  /** A size present here wins over the focal-derived crop, permanently. */
  cropOverrides: Partial<Record<SizeId, NormRect>>;
  /**
   * Top of the price override chain: job → batch → settings → fallback.
   * Only the sizes actually changed appear here; the rest fall through.
   */
  priceOverrides: Partial<Record<SizeId, string>>;
  compareAtOverrides: Partial<Record<SizeId, string>>;
  assets: RenderedAsset[];
  mockups: RenderedMockup[];
  selectedTemplateIds: string[];
  /** The gallery, in order. `images[0]` becomes the product thumbnail. */
  images: ProductImageRef[];
  drive: DriveRefs | null;
  shopify: ShopifyRefs | null;
  createdAt: number;
  updatedAt: number;
};

export type Batch = {
  id: string;
  name: string;
  category: CategoryId;
  /** Default kind for jobs ingested into this batch. */
  kind: PosterKind;
  /** Library images attached to every job in the batch by default. */
  defaultLibraryIds: string[];
  /**
   * Batch-level prices, set at upload time. Override the dashboard defaults
   * and are in turn overridden per poster. Sizes left blank fall through, so
   * "this batch is premium A3 only" is a one-field edit.
   */
  prices: Partial<Record<SizeId, string>>;
  compareAt: Partial<Record<SizeId, string>>;
  jobIds: string[];
  createdAt: number;
  updatedAt: number;
};

/**
 * Note: `MockupTemplate.kind` ("flat" | "perspective") is the template's
 * projection geometry and is unrelated to `PosterKind` ("normal" | "split3"),
 * which is the product format. Both discriminate their own union and never
 * appear on the same object.
 */
export type MockupTemplate =
  | {
      id: string;
      name: string;
      kind: "flat";
      background: string;
      overlay?: string;
      canvas: { width: number; height: number };
      /** Axis-aligned pixel rect on the canvas where the poster goes. */
      rect: { x: number; y: number; width: number; height: number };
      shadow?: number;
      suitsAspect?: number[];
      /** Canvas-px gap between panels, split jobs only. Default 12. */
      panelGap?: number;
    }
  | {
      id: string;
      name: string;
      kind: "perspective";
      background: string;
      overlay?: string;
      canvas: { width: number; height: number };
      /**
       * Destination quad in canvas pixels, in TL → TR → BR → BL order. The
       * order is load-bearing: the homography maps the poster's unit corners
       * onto these in exactly this sequence, so a shuffled quad produces a
       * mirrored or bow-tied poster rather than an error.
       */
      corners: [Pt, Pt, Pt, Pt];
      shadow?: number;
      suitsAspect?: number[];
      panelGap?: number;
    };

/** An entry in the reusable product-image library (size guide, quality info…). */
export type LibraryImage = {
  id: string;
  file: string;
  name: string;
  role: "size-guide" | "quality" | "shipping" | "other";
};
