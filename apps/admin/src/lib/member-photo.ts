/** Resize a selected profile image to a compact JPEG data URL for member.photoUrl. */
export function memberPhotoFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Unsupported image type"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("Image must be 5 MB or smaller"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read image"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Unable to decode image"));
      image.onload = () => {
        const maxDimension = 512;
        const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = longestSide > maxDimension ? maxDimension / longestSide : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Unable to process image"));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Unable to encode image"));
              return;
            }
            const output = new FileReader();
            output.onerror = () => reject(new Error("Unable to encode image"));
            output.onload = () => resolve(String(output.result));
            output.readAsDataURL(blob);
          },
          "image/jpeg",
          0.82,
        );
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
