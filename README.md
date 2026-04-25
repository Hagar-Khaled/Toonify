# Toonify

Toonify is a browser-based computer vision demo that turns photos into a cartoon-style image using two manual steps:

1. Sobel edge detection to find strong outlines.
2. Color quantization to flatten the image into bold painted regions.

The app is designed for a live demo and does not use OpenCV. All processing happens in `script.js` with basic pixel loops.

## Features

- Upload any image and process it in the browser.
- Load a built-in demo scene for instant testing.
- Adjust the edge threshold to make outlines softer or stronger.
- Download the toonified result as a PNG.

## Run

Open `index.html` directly in a browser, or serve the folder locally:

```powershell
python -m http.server 8000
```

Then open `http://127.0.0.1:8000`.

## Notes

- The implementation uses nested loops and manual Sobel math instead of library filters.
- The source image is scaled down before processing so the GUI stays responsive during a live demo.
- The built-in demo scene is useful if you need a guaranteed test image during presentation.