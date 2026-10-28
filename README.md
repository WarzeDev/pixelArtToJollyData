# Pixel Art to JollyData

![Pixel Art to JollyData screenshot](screenshot.png)

A lightweight, browser-based pixel-art editor that converts your drawing
into compressed JollyData output.

## Features

-   **Tools:** draw, erase, flood fill, line, rectangle, filled rectangle
    and an eyedropper. Right click erases with any tool.
-   **Undo / redo** (100 steps).
-   **Color picker** plus a palette of the last 8 colors you drew with
    (saved locally).
-   **Canvas width and height** are independent, from **1** to **128**
    pixels. Resizing keeps your drawing and crops what falls outside.
-   Every number (width, height, in-game size) works as a slider and as a
    typed value.
-   **Zoom and pan** for large canvases.
-   **Transform:** flip, rotate and shift (wrapping) the whole drawing.
-   **Import** a PNG (you are asked whether to resize the canvas when the
    image is up to 128 x 128) or paste JollyData made by this tool.
-   **Export** the canvas as a 1:1 PNG.
-   **Generate** JollyData and copy it to the clipboard. A warning icon
    appears when there are a lot of shapes or an outline was cut off.
-   **Autosave:** your drawing, sizes and color are restored on reload.
-   Light and dark themes; mouse, touch and pen input.

## Shortcuts

| Key | Action |
| --- | --- |
| D / E / F / L / R / Shift+R / I | Draw / erase / fill / line / rectangle / filled rectangle / eyedropper |
| Alt + click | Pick a color from the canvas |
| Ctrl+Z, Ctrl+Y (Ctrl+Shift+Z) | Undo, redo |
| Arrow keys | Shift the drawing |
| [ and ] | Change in-game size |
| + / - / 0 | Zoom in / out / reset |
| Mouse wheel | Zoom at the pointer |
| Space + drag, or middle-drag | Pan (two fingers on touch screens) |

## Getting started

1.  Keep the project files together in one directory.
2.  Make sure the required `lzstring.min.js` file is available alongside
    `index.html`.
3.  Open `index.html` in a modern browser.

No build step is required.

## How to use

1.  Draw on the canvas, or choose **Choose PNG** to import an image.
2.  Select **Draw** or **Erase** and choose a color as needed (or click a
    recent color in the palette). Right-click also erases.
3.  Adjust **Canvas width**, **Canvas height** and **In-game size** with
    the sliders or by typing a value and pressing Enter.
4.  Select **Generate**. The generated JollyData string appears in the
    output area and is copied to the clipboard when browser permissions
    allow.
5.  Use the copy button to copy the output again.

## Project files

-   `index.html` --- application structure and controls.
-   `styles.css` --- layout, responsive styling, and light/dark themes.
-   `main.js` --- drawing tools, PNG import, shape generation, and
    output compression.
-   `lzstring.min.js` --- LZ-String compression dependency.
-   `screenshot.png` --- project screenshot displayed at the top of this
    README.

## Notes

-   PNGs are drawn at the current canvas size (after the optional resize
    prompt); pixels outside the canvas are cropped.
-   The initial canvas size is **16 × 16**, and the default in-game size
    is **8 units per pixel**.
-   The output is compressed using LZ-String into a JollyData string.

## Credits

Made with love by [Warze](https://warze.org).