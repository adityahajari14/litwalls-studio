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
 * A collection handle. Was a closed union of four, which meant adding a
 * category was a code change; it is now whatever Shopify reports.
 */
export type CategoryId = string;

/**
 * A collection a batch can publish into.
 *
 * Drives three things at once — the title suffix, the tag that grants
 * collection membership, and the Drive folder — which is why a batch picks one
 * rather than each stage guessing.
 */
export type Category = {
  /** The collection handle, e.g. "movies-tv". */
  id: CategoryId;
  /** Display name, e.g. "Movies & TV". */
  label: string;
  /** Title suffix, e.g. "Movies & TV Posters". */
  suffix: string;
  /**
   * The tag that puts a product in this collection. Null for a manual
   * collection, where membership needs an explicit add rather than a tag.
   */
  tag: string | null;
  collectionId: string;
  smart: boolean;
};

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
  /**
   * Perceptual fingerprint of the source artwork, for duplicate detection.
   * Null on jobs probed before fingerprinting existed.
   */
  fingerprint?: string | null;
  /** Anything already published that looks like this. Empty is the norm. */
  duplicates?: {
    productId: string;
    title: string;
    handle: string;
    distance: number;
  }[];
  /** Effective DPI at each size, given the master's real pixels. */
  dpiBySize: Record<SizeId, number>;
  /**
   * Fraction of the source that survives the widest crop, 0..1.
   *
   * Exists because a split poster is very wide (three sheets side by side, so
   * roughly 2.12:1 for A-series) and a portrait source simply cannot fill that
   * shape — the crop is forced into a narrow horizontal band and most of the
   * artwork is discarded. The geometry is correct, but silently throwing away
   * two thirds of a poster is not something a human should discover after
   * publishing. Below COVERAGE_WARN the review UI says so plainly.
   */
  coverage: number;
};

/**
 * Warn when a crop keeps less than this much of the source.
 *
 * 0.5 is a judgement call: losing a little to aspect-fitting is normal and
 * expected, but keeping under half the artwork usually means the source is the
 * wrong shape for the format rather than merely needing a trim.
 */
export const COVERAGE_WARN = 0.5;

/**
 * The parts of a product title we generate.
 *
 * The full title is assembled by `formatTitle()` and never stored pre-joined:
 * the sequence number is resolved at publish time against the live catalogue,
 * so a stored string would have to be re-parsed and rewritten. Keeping the
 * parts separate makes that a field update instead of string surgery.
 *
 * `description` IS generated here, unlike the rest of the title — it is
 * prose, not a title part, and Gemini writes a fresh paragraph per poster
 * rather than filling in a template. `print/description.ts` only appends
 * the policy block (border, adhesive, colour) that's shared by every
 * product; that part stays a Settings-editable constant, not per-poster.
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
   * A short, poster-specific opening for the product description — what it
   * depicts, in the model's own words each time rather than a filled-in
   * template. Empty when Gemini was unavailable; `descriptionFor` falls back
   * to a plain line built from `subject` in that case.
   */
  description: string;
  /**
   * The collection the model thinks this belongs in FIRST, by handle — the
   * main one, whose name goes in the title.
   *
   * A fixed batch picks one collection, but batches are often mixed — a Marvel
   * drop containing a Star Wars poster. When this disagrees with the batch,
   * the review screen says so. On a FIXED batch it is a suggestion, never
   * applied automatically: moving a product between collections changes its
   * title suffix, and doing that silently would be worse than the occasional
   * misfile. On an AUTO batch it is applied — that is what auto means.
   */
  suggestedCategoryId?: string | null;
  /**
   * Every collection the model thinks this belongs in, by handle, MAIN FIRST.
   *
   * A poster is rarely in exactly one: a Spider-Man still is Marvel and
   * Movies & TV and Superheroes at once, and a shopper browsing any of the
   * three should find it. `suggestedCategoryId` is this list's first entry,
   * kept as its own field because jobs analyzed before this existed have only
   * that one.
   */
  suggestedCategoryIds?: string[];
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
  /**
   * The print size this mockup shows, when the template renders per size.
   * Null for a template that renders one shared image.
   */
  sizeId?: SizeId | null;
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
   * Model-chosen crops for sizes whose shape differs sharply from the source.
   *
   * Distinct from `cropOverrides`, which is a human's decision: these are
   * suggestions the renderer uses when nothing better exists, and a human edit
   * still wins. Kept separate so "reset to auto" returns to the AI crop rather
   * than to a centred one.
   */
  aiCrops?: Partial<Record<SizeId, { rect: NormRect; reason: string }>>;
  /**
   * Top of the price override chain: job → batch → settings → fallback.
   * Only the sizes actually changed appear here; the rest fall through.
   */
  priceOverrides: Partial<Record<SizeId, string>>;
  compareAtOverrides: Partial<Record<SizeId, string>>;
  assets: RenderedAsset[];
  mockups: RenderedMockup[];
  selectedTemplateIds: string[];
  /**
   * The collections this poster publishes into, MAIN FIRST — a snapshot, for
   * the same reason `Batch.category` is one.
   *
   * Null means "whatever the batch says", which is the whole story for a
   * batch with a fixed collection. An auto batch fills this in at analyze
   * time from the model's ranked suggestion, and a human can change it on the
   * review screen. `categories[0]` is the main one: its suffix goes in the
   * title, its handle in the SKU, its label on the Drive folder.
   */
  categories?: Category[] | null;
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
  /**
   * A SNAPSHOT of the collection, not a reference.
   *
   * Carrying the label, suffix and tag means a batch published months later
   * still uses the naming that was correct when it was created, and that
   * nothing needs a live Shopify call to render a title.
   *
   * NULL means the batch is on AUTO: every poster gets its own collections,
   * chosen per poster at analyze time and stored on the job. Null is the
   * whole representation of auto — there is no second flag that could
   * disagree with it, and a batch created before auto existed reads as fixed
   * because its category is already there.
   */
  category: Category | null;
  /** Default kind for jobs ingested into this batch. */
  kind: PosterKind;
  /** Library images attached to every job in the batch by default. */
  defaultLibraryIds: string[];
  /**
   * Mockup templates every job in the batch renders with by default — copied
   * onto each job's `selectedTemplateIds` at creation. Empty means the mockup
   * stage falls back to its automatic pick.
   */
  defaultTemplateIds: string[];
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
/** An axis-aligned placement area, in canvas pixels. */
export type PlacementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Where the poster sits on the wall, per print size.
 *
 * A template defines the area for ONE reference size. The other sizes are
 * derived from it by real-world scale — an A5 is 49.8% of an A3 linearly, so
 * it occupies a proportionally smaller patch of the same wall. That is what
 * makes a set of mockups honest: showing the same poster at the same size for
 * every variant tells the customer nothing about what they are choosing.
 *
 * Any size can be overridden by hand when the derived placement is wrong —
 * a shelf in the way, a frame that only fits one size.
 */
export type SizePlacement<T> = {
  /** The size the base placement was authored against. */
  referenceSize: SizeId;
  /** The base placement, for `referenceSize`. */
  base: T;
  /** Hand-adjusted placements. Anything absent is derived from `base`. */
  overrides?: Partial<Record<SizeId, T>>;
  /**
   * Render one mockup per size rather than a single shared one.
   *
   * Off by default because it multiplies render time by four, and most
   * templates look fine with one image. Worth turning on for the hero
   * template, where each variant getting its own correctly-scaled mockup is
   * exactly what makes the size selector meaningful.
   */
  perSize?: boolean;
};

/**
 * Placement for a split-3 poster's ASSEMBLED panel set — a different shape
 * entirely from a single sheet, roughly twice as wide as it is tall rather
 * than portrait. Authored against the same reference size as `sizing`/`rect`
 * (there is no separate reference size to pick), so `base` is the placement
 * at whichever size `sizing.referenceSize` names.
 *
 * Absent means a split poster falls back to the single-sheet `rect`/`sizing`,
 * which is almost always too small: a triptych fitted into a box drawn for
 * one portrait sheet is bound by height, leaving most of the box's width
 * unused. A template meant to show split posters should set this.
 *
 * This is the HORIZONTAL box — see `splitVerticalSizing` below, on
 * `MockupTemplate`, for the independent one used to show the same assembled
 * set turned. The physical object described here never changes shape between
 * the two; only how it is drawn on a particular wall photo does.
 */
export type SplitPlacement<T> = {
  base: T;
  overrides?: Partial<Record<SizeId, T>>;
};

/**
 * Placement for a SINGLE poster whose source is landscape rather than
 * portrait — the same object as the normal `rect`/`sizing` (one sheet, not an
 * assembled set), just shaped the other way. A wall photo's landscape frame
 * is rarely the portrait frame rotated in place; it is usually a different
 * area entirely, so this is authored and positioned independently rather than
 * derived by flipping `rect`.
 *
 * Same shape as `SplitPlacement` — authored against the same reference size,
 * no `perSize` of its own — but kept as a distinct type rather than reused
 * under that name, since the two are picked by unrelated conditions (source
 * orientation vs. poster kind) and conflating the names would make a caller's
 * intent unclear at the call site.
 *
 * Absent means a landscape single falls back to `rect`/`sizing`, shrunk to
 * fit inside the portrait box — correct but wastes wall space on either side.
 */
export type LandscapePlacement<T> = {
  base: T;
  overrides?: Partial<Record<SizeId, T>>;
};

type TemplateBase = {
  id: string;
  name: string;
  background: string;
  overlay?: string;
  canvas: { width: number; height: number };
  shadow?: number;
  suitsAspect?: number[];
  /**
   * What this template is MEANT to show, declared by its author.
   *
   * `suitsAspect` is a hint the auto-picker scores against; this is a hard
   * filter. A template flagged `formats: ["split3"]` is never auto-selected
   * for a single-sheet poster, and one flagged `orientations: ["portrait"]`
   * is skipped for a landscape source. An absent field, or an empty array on
   * a facet, means "all of them" — the same behaviour templates had before
   * this existed. A template a human explicitly picks (per job, or as a batch
   * default) is still rendered regardless: this only governs the automatic
   * choice.
   */
  suits?: {
    formats?: PosterKind[];
    orientations?: ("portrait" | "landscape")[];
  };
  /**
   * Gap between the three panels of a split poster, as a PERCENTAGE OF PANEL
   * WIDTH. Split jobs only. Default 1.2.
   *
   * A percentage, not pixels: the assembled strip is scaled down heavily to
   * sit on a mockup wall, so a pixel gap set at print resolution arrives
   * sub-pixel and vanishes.
   */
  panelGap?: number;
};

export type MockupTemplate =
  | (TemplateBase & {
      kind: "flat";
      /** Axis-aligned pixel rect on the canvas where the poster goes. */
      rect: PlacementRect;
      /** Per-size placement. Absent means every size uses `rect`. */
      sizing?: SizePlacement<PlacementRect>;
      splitSizing?: SplitPlacement<PlacementRect>;
      /**
       * A SECOND, independent split-3 box for showing the same assembled
       * panel set turned on this wall photo — a hallway or stairwell where
       * the wide triptych reads better mounted tall. Not derived from
       * `splitSizing` by flipping it: the two are authored, edited, and
       * saved separately, so repositioning one never touches the other.
       * Absent means it falls back to `splitSizing` (itself possibly a
       * fallback) turned on its side — see `rectForSize`.
       */
      splitVerticalSizing?: SplitPlacement<PlacementRect>;
      landscapeSizing?: LandscapePlacement<PlacementRect>;
    })
  | (TemplateBase & {
      kind: "perspective";
      /**
       * Destination quad in canvas pixels, in TL → TR → BR → BL order. The
       * order is load-bearing: the homography maps the poster's unit corners
       * onto these in exactly this sequence, so a shuffled quad produces a
       * mirrored or bow-tied poster rather than an error.
       */
      corners: [Pt, Pt, Pt, Pt];
      sizing?: SizePlacement<[Pt, Pt, Pt, Pt]>;
      splitSizing?: SplitPlacement<[Pt, Pt, Pt, Pt]>;
      /** See the flat variant's `splitVerticalSizing`. No automatic turn
       *  exists for an angled quad, so this is used only when authored. */
      splitVerticalSizing?: SplitPlacement<[Pt, Pt, Pt, Pt]>;
      landscapeSizing?: LandscapePlacement<[Pt, Pt, Pt, Pt]>;
    });

/** An entry in the reusable product-image library (size guide, quality info…). */
export type LibraryImage = {
  id: string;
  file: string;
  name: string;
  role: "size-guide" | "quality" | "shipping" | "other";
};
