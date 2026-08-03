import { describe, expect, it } from "vitest";
import { ImageValidationError, SharpImageProcessor } from "@lyra/storage";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("SharpImageProcessor", () => {
  it("reads image metadata and creates a WebP thumbnail", async () => {
    const processor = new SharpImageProcessor();
    const result = await processor.process(PNG_1X1);

    expect(result).toMatchObject({
      format: "png",
      mimeType: "image/png",
      extension: "png",
      width: 1,
      height: 1,
      byteSize: PNG_1X1.length
    });
    expect(result.thumbnail.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(result.thumbnail.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("rejects invalid content and configured size violations", async () => {
    await expect(new SharpImageProcessor().process(Buffer.from("not an image"))).rejects.toBeInstanceOf(
      ImageValidationError
    );
    await expect(
      new SharpImageProcessor({ maxByteSize: 10 }).process(PNG_1X1)
    ).rejects.toThrow("exceeds the size limit");
  });
});
