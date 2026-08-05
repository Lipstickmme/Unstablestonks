import imageCompression from "browser-image-compression";

export async function compressImage(file: File, maxSizeKB: number = 5): Promise<File> {
  const maxSizeBytes = maxSizeKB * 1024;
  let quality = 0.7; // Start higher for better clarity
  let maxWidthOrHeight = 640; // Higher starting resolution
  
  // Iteratively compress until we're under the size limit
  for (let attempt = 0; attempt < 10; attempt++) {
    const options = {
      maxSizeMB: maxSizeKB / 1024,
      maxWidthOrHeight: maxWidthOrHeight,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: quality,
    };

    try {
      const compressedFile = await imageCompression(file, options);
      const fileSize = compressedFile.size;
      console.log(`Compression attempt ${attempt + 1}: ${fileSize} bytes (target: ${maxSizeBytes} bytes)`);
      
      // Use a buffer - ensure we're at least 100 bytes under the limit
      if (fileSize <= maxSizeBytes - 100) {
        return compressedFile;
      }
      
      // Gradual reduction while trying to keep clarity
      if (quality > 0.3) {
        quality -= 0.05; // Reduce by 5% each time
      } else if (maxWidthOrHeight > 240) {
        maxWidthOrHeight -= 80;
        quality = 0.35; // Reset quality when reducing dimensions
      } else {
        quality = 0.25;
        maxWidthOrHeight = 240;
      }
    } catch (error) {
      console.error("Image compression error:", error);
      throw error;
    }
  }
  
  // Final aggressive attempt
  const finalOptions = {
    maxSizeMB: maxSizeKB / 1024,
    maxWidthOrHeight: 240,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.25,
  };
  
  const finalCompressed = await imageCompression(file, finalOptions);
  const finalSize = finalCompressed.size;
  
  if (finalSize > maxSizeBytes) {
    throw new Error(`Image could not be compressed below ${maxSizeKB}KB. Current size: ${(finalSize / 1024).toFixed(2)}KB. Please try a smaller, simpler image or a different image format.`);
  }
  
  return finalCompressed;
}

export async function fileToBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(e.target.result));
      } else {
        reject(new Error("Failed to read file"));
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function bytesToDataUrl(bytes: Uint8Array): string {
  const blob = new Blob([bytes as BlobPart], { type: "image/jpeg" });
  return URL.createObjectURL(blob);
}

export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}

