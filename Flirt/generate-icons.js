/**
 * Generate PWA icons for Flirt Hair & Beauty
 * Run: node generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// Simple PNG generator for a pink circle with "F" letter
// This creates a minimal valid PNG without requiring any external libraries

function createPngIcon(size) {
    // Create a simple SVG and convert to data for embedding
    // For now, create placeholder PNGs that are valid

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#F67599;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#e05a7f;stop-opacity:1" />
            </linearGradient>
        </defs>
        <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="url(#grad)"/>
        <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
              font-family="Arial, sans-serif" font-weight="bold" font-size="${size * 0.5}px" fill="white">F</text>
    </svg>`;

    return svg;
}

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const iconsDir = path.join(__dirname, 'icons');

// Ensure icons directory exists
if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir);
}

// Generate SVG icons (browsers can use SVG in manifest now)
sizes.forEach(size => {
    const svg = createPngIcon(size);
    const filename = `icon-${size}x${size}.svg`;
    fs.writeFileSync(path.join(iconsDir, filename), svg);
    console.log(`Created ${filename}`);
});

console.log('\nSVG icons generated!');
console.log('Note: Update manifest.json to use .svg extension instead of .png');
