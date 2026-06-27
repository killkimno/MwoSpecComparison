# MWO Mechlab

Static MechWarrior Online mechlab built from extracted local game data.

## Run

Open the deployed GitHub Pages site, or serve the `public` folder with any static file server.

## Update Data

```powershell
python tools\extract_mwo_data.py --game-dir "<MechWarrior Online install directory>" --out public\data
```

Commit the updated files under `public/data` when the extracted data should be published.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes the `public` folder as a static GitHub Pages site. Configure the repository's Pages source to GitHub Actions.

## Notes

- The extractor reads local `.pak` files and writes browser-ready JSON.
- Images are not generated or published.
- The web app is static: all mechlab behavior runs in the browser from JSON files.
- Online MechDB account, wiki, build sharing, and dropship features are intentionally out of scope.
