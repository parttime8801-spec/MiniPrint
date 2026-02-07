class EscPosEncoder {
    constructor() {
        this.buffer = [];
    }

    initialize() {
        this.buffer.push(0x1B, 0x40); // ESC @ (Initialize)
        return this;
    }

    // GS v 0 - Raster Bit Image
    // mode: 0 (Normal), 1 (Double Width), 2 (Double Height), 3 (Quadruple)
    raster(image, maxWidth = 384, threshold = 128) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Calculate new dimensions maintaining aspect ratio
        let width = image.width;
        let height = image.height;
        
        if (width > maxWidth) {
            height = Math.round((maxWidth / width) * height);
            width = maxWidth;
        }

        // Align width to 8 bytes (since 1 byte = 8 pixels)
        // width must be divisible by 8 for raster mode
        if (width % 8 !== 0) {
            width += 8 - (width % 8);
        }

        canvas.width = width;
        canvas.height = height;

        // Draw image to canvas
        // Fill white background first (for transparent PNGs)
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);

        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        // Convert to monochrome (1 bit per pixel)
        // 0 = White (Paper), 1 = Black (Dot)
        // Implementation of Floyd-Steinberg Dithering could be added here for better photos
        // For distinct text/barcodes, simple threshold is better.
        
        const bytesPerLine = Math.ceil(width / 8);
        const rasterData = new Uint8Array(bytesPerLine * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const offset = (y * width + x) * 4;
                const r = data[offset];
                const g = data[offset + 1];
                const b = data[offset + 2];
                // Luminance formula
                const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
                
                // If dark -> print dot (bit 1)
                if (brightness < threshold) {
                    const byteIndex = y * bytesPerLine + Math.floor(x / 8);
                    const bitIndex = 7 - (x % 8);
                    rasterData[byteIndex] |= (1 << bitIndex);
                }
            }
        }

        // Header for GS v 0
        // Command: GS v 0 m xL xH yL yH d1...dk
        // m = 0 (Normal)
        // xL, xH = number of bytes in horizontal direction
        // yL, yH = number of dots in vertical direction
        
        this.buffer.push(0x1D, 0x76, 0x30, 0x00);
        this.buffer.push(bytesPerLine & 0xff, (bytesPerLine >> 8) & 0xff);
        this.buffer.push(height & 0xff, (height >> 8) & 0xff);
        
        // Append data
        for (let i = 0; i < rasterData.length; i++) {
            this.buffer.push(rasterData[i]);
        }
        
        return this;
    }

    feed(lines = 3) {
        this.buffer.push(0x1B, 0x64, lines); // ESC d n (Print and feed n lines)
        return this;
    }
    
    cut() {
         this.buffer.push(0x1D, 0x56, 0x42, 0x00); // GS V m n (Cut)
         return this;
    }

    encode() {
        return new Uint8Array(this.buffer);
    }
}
