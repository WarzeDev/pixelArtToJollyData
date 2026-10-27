# Pixel Art to JollyData

![Pixel Art to JollyData screenshot](screenshot.png)

A lightweight, browser-based pixel-art editor that converts your drawing
into compressed JollyData output.

## Features

-   Draw and erase pixels on a canvas.
-   Choose a drawing color; the last 8 colors you drew with are kept in a
    palette below the picker (saved locally).
-   Set canvas **width** and **height** independently, from **1** to
    **128** pixels. Resizing keeps your drawing and crops whatever falls
    outside the new size.
-   Every number (width, height, in-game size) can be dragged on a slider
    or typed in directly.
-   Import PNG images. If the image is up to 128 × 128 and differs from the
    canvas, you are asked whether to resize the canvas to match it;
    otherwise pixels outside the canvas are cropped.
-   Set the in-game size used to scale pixel coordinates.
-   Generate JollyData output and copy it to the clipboard.
-   Switch between light and dark themes; the selected theme is saved
    locally.
-   Use mouse, touch, or pen input.

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
