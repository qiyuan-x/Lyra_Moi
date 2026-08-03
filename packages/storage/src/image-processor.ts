import sharp from "sharp";

const SUPPORTED_FORMATS = {
  jpeg: { mimeType: "image/jpeg", extension: "jpg", fileExtensions: ["jpg", "jpeg", "jpe"] },
  png: { mimeType: "image/png", extension: "png", fileExtensions: ["png"] },
  webp: { mimeType: "image/webp", extension: "webp", fileExtensions: ["webp"] },
  gif: { mimeType: "image/gif", extension: "gif", fileExtensions: ["gif"] },
  avif: { mimeType: "image/avif", extension: "avif", fileExtensions: ["avif"] }
} as const;

type SupportedImageFormat = keyof typeof SUPPORTED_FORMATS;

export interface ImageProcessorOptions {
  maxByteSize?: number;
  maxPixels?: number;
  maxDimension?: number;
  thumbnailSize?: number;
}

export interface ProcessedImage {
  format: SupportedImageFormat;
  mimeType: string;
  extension: string;
  allowedFileExtensions: readonly string[];
  width: number;
  height: number;
  byteSize: number;
  thumbnail: Buffer;
}

export interface PreparedModelInputImage {
  data: Buffer;
  mimeType: "image/jpeg";
  extension: "jpg";
}

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export class SharpImageProcessor {
  readonly #maxByteSize: number;
  readonly #maxPixels: number;
  readonly #maxDimension: number;
  readonly #thumbnailSize: number;

  constructor(options: ImageProcessorOptions = {}) {
    this.#maxByteSize = options.maxByteSize ?? 25 * 1024 * 1024;
    this.#maxPixels = options.maxPixels ?? 64_000_000;
    this.#maxDimension = options.maxDimension ?? 16_384;
    this.#thumbnailSize = options.thumbnailSize ?? 512;
    for (const [name, value] of Object.entries({
      maxByteSize: this.#maxByteSize,
      maxPixels: this.#maxPixels,
      maxDimension: this.#maxDimension,
      thumbnailSize: this.#thumbnailSize
    })) {
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer.`);
      }
    }
  }

  async process(data: Buffer): Promise<ProcessedImage> {
    if (data.length === 0) throw new ImageValidationError("Image file is empty.");
    if (data.length > this.#maxByteSize) {
      throw new ImageValidationError("Image file exceeds the size limit.");
    }

    let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
    try {
      metadata = await sharp(data, {
        limitInputPixels: this.#maxPixels,
        failOn: "warning"
      }).metadata();
    } catch {
      throw new ImageValidationError("Image content is invalid or unsupported.");
    }

    if (!metadata.format || !isSupportedFormat(metadata.format)) {
      throw new ImageValidationError("Image format is not supported.");
    }
    if (!metadata.width || !metadata.height) {
      throw new ImageValidationError("Image dimensions could not be read.");
    }
    const swapsDimensions =
      metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
    const width = swapsDimensions ? metadata.height : metadata.width;
    const height = swapsDimensions ? metadata.width : metadata.height;
    if (
      width > this.#maxDimension ||
      height > this.#maxDimension ||
      width * height > this.#maxPixels
    ) {
      throw new ImageValidationError("Image dimensions exceed the configured limit.");
    }

    let thumbnail: Buffer;
    try {
      thumbnail = await sharp(data, {
        limitInputPixels: this.#maxPixels,
        failOn: "warning"
      })
        .rotate()
        .resize({
          width: this.#thumbnailSize,
          height: this.#thumbnailSize,
          fit: "inside",
          withoutEnlargement: true
        })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
    } catch {
      throw new ImageValidationError("Image could not be decoded.");
    }

    const format = SUPPORTED_FORMATS[metadata.format];
    return {
      format: metadata.format,
      mimeType: format.mimeType,
      extension: format.extension,
      allowedFileExtensions: format.fileExtensions,
      width,
      height,
      byteSize: data.length,
      thumbnail
    };
  }

  async prepareModelInput(
    data: Buffer,
    maxByteSize = 5 * 1024 * 1024,
    maxDimension = 4096
  ): Promise<PreparedModelInputImage> {
    if (!Number.isInteger(maxByteSize) || maxByteSize < 1024) {
      throw new Error("Model input byte limit is invalid.");
    }
    if (!Number.isInteger(maxDimension) || maxDimension < 256) {
      throw new Error("Model input dimension limit is invalid.");
    }
    await this.process(data);
    let dimension = maxDimension;
    for (const quality of [92, 86, 80, 74, 68]) {
      let output: Buffer;
      try {
        output = await sharp(data, {
          limitInputPixels: this.#maxPixels,
          failOn: "warning"
        })
          .rotate()
          .flatten({ background: "#ffffff" })
          .resize({
            width: dimension,
            height: dimension,
            fit: "inside",
            withoutEnlargement: true
          })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
      } catch {
        throw new ImageValidationError("Image could not be prepared for model generation.");
      }
      if (output.length <= maxByteSize) {
        return { data: output, mimeType: "image/jpeg", extension: "jpg" };
      }
      dimension = Math.max(256, Math.floor(dimension * 0.82));
    }
    throw new ImageValidationError("Image cannot be reduced to the model provider size limit.");
  }
}

function isSupportedFormat(format: string): format is SupportedImageFormat {
  return Object.hasOwn(SUPPORTED_FORMATS, format);
}
