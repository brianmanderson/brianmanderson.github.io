# Brian Anderson

Personal website of Brian Anderson. A static site (plain HTML, CSS and JavaScript, no build step).

## Preview locally

```
python -m http.server 4173
```

Then open http://localhost:4173.

## Editing content

All site content lives in `assets/js/data.js`; the page components render from it.

## Publications

The publication list in `assets/js/publications.js` is generated from the CV:

```
python tools/build_pubs.py "<path to CV .docx>" assets/js/publications.js
```

This requires `python-docx` (`pip install python-docx`).
