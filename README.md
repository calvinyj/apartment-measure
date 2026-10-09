# Apartment Measure

Check an apartment's real floor area against the advertised figure, and size the aircon for each space. You start from a 2D floor plan image, and the app walks you through measuring every wall on site.

## Run it

```sh
npm install
npm run dev        # API on :8787 + web app on http://localhost:5173
npm test           # geometry + API tests
npm run build      # type-check and build the web app into dist/
npm start          # production: one process serves dist/ and the API on :8787
```

To try it from your phone on the same Wi-Fi, run `npm run build && npm start`, then open `http://<your-computer's-IP>:8787` on the phone.

### Configuration (environment variables)

| Variable      | Default                      | Purpose                                               |
| ------------- | ---------------------------- | ----------------------------------------------------- |
| `PORT`        | `8787`                       | HTTP port                                             |
| `DB_PATH`     | `data/apartment-measure.db`  | SQLite database file                                  |
| `UPLOADS_DIR` | `data/uploads`               | Plan images, one folder per layout                    |
| `ACCESS_KEY`  | *(unset)*                    | If set, the app asks for this key once on each device |

Set `ACCESS_KEY` whenever the server can be reached from the internet.

## Storage

- **SQLite** (`data/apartment-measure.db`, built into Node, so nothing to install):
  - `layouts`: one row per layout. The rooms, measurements and settings are stored as a JSON document, with a `revision` number.
  - `layout_images`: records which image file belongs to each layout.
  - Schema changes are versioned in `server/db.ts` (`MIGRATIONS`, tracked with `PRAGMA user_version`).
- **Plan images** are plain files on disk: `data/uploads/<layout-id>/plan-<n>.jpg`. To back everything up, copy the `data/` folder.
- **Saving** happens automatically, a moment after each edit. Every edit is also kept in the browser until the server confirms it. If the phone loses signal on site, the header shows "Offline · kept on this device" and the edits are sent once it reconnects.
- **Two devices** (e.g. phone and laptop): if one saves a newer version, the other gets a banner offering "Load the other version" or "Keep mine" instead of silently overwriting. Each save carries the revision it was based on; the server rejects the save if a newer one exists.
- **Export / import**: Settings → Export layout produces a single file with the image embedded, and Layouts → Import from file loads one.

## Workflow

0. **Layouts**: create one layout per apartment you're checking. You can switch between them from the name at the top left.
1. **Plan** (easier on a laptop)
   - Upload the plan image.
   - **Set scale**: tap both ends of a printed dimension, such as the 12300 line, and enter its real length.
   - **Draw room**: trace each room along the *inside* faces of its walls. Corners snap to straight lines and line up with other rooms' corners. Mark boundaries with no wall (open plan) as **Open**.
   - Set each room's type, put open-plan spaces in a shared **aircon zone**, and note any aircon that's already installed.
   - **North** (optional): turn the dial until its needle matches the plan's north arrow, or type the bearing in degrees. With no arrow on the plan, use Google Maps to see which way the windows face. The app then knows which way each room faces.
2. **Measure** (on site, on your phone)
   - For each room, enter the ceiling height, then go wall by wall from corner A to corner B. The plan's estimate is shown, and a reading more than 8% (or 150 mm) off it is flagged.
   - You can skip a wall you can't reach. It is worked out from the other walls.
   - Optionally enter the wall thickness (measure it at a door frame) and the doors and windows on each wall.
   - **Rescale** if the plan isn't to scale. Brochure plans often aren't quite to scale. Once you've measured 3 or more walls, the room list tells you if they come out consistently longer or shorter than the plan (by 1% or more), and **Rescale the plan to match** fits the scale to them. Any wall you skipped then gets a better estimate. The same option is under **Set scale** on the Plan tab, with **Undo** straight after.
   - If the plan is wrong in places rather than just the wrong size, untick **Plan image** above the plan (Plan, Measure, 2D or 3D) to hide it for this layout.
3. **2D**: a read-only floor plan drawn from your measurements: solid walls cut at 1.2 m, windows, door gaps, room names and areas, and each wall's length (as measured, or `≈` the worked-out length for a wall you skipped). Pinch or scroll to zoom. To turn the plan, twist with two fingers, drag with the right mouse button (or Shift-drag), or use the ↺ ↻ buttons. It snaps square near each quarter turn. With north set, **North up** turns north to the top.
4. **3D**: orbit around the model, cut the walls at 1.2 m to see the layout, and show the plan image underneath. Inside walls are drawn in the paint colour set in **Settings → Paint** (a hex code such as `#c8d8c0`). To give one wall a different colour, open **Paint** on that wall's Measure step. The outside of the unit stays off-white.
5. **Report**: net area, estimated built-up area, a comparison with the advertised area, a per-room table, aircon sizing, and a CSV export.

## How the numbers are worked out

- **Room closure.** Wall directions come from the traced plan and lengths come from your tape. Real measurements never close a room perfectly, so lengths are adjusted by weighted least squares until the outline closes exactly (`src/geometry/closure.ts`). The size of the adjustment taken up by measured walls is the room's *closure error*. A room is flagged when that error exceeds the tolerance (25 mm by default). Unmeasured walls are loose priors, so a skipped wall absorbs the error in its own direction.
- **Rescaling.** Each measured wall gives a scale: its length plus the wall thickness between the traced line and the inside face, divided by its traced length in pixels. Walls more than 8% (or 150 mm) off the median are left out, as a typo or a spot where the plan is wrong. The rest are fitted by least squares, so long walls count most (`src/geometry/scale.ts`). Rescaling only changes the real length of the dimension you set the scale with. Your measurements stay as they are.
- **Placement.** Each room is shifted, again by least squares, so that faces on either side of a shared wall end up exactly one *measured* wall thickness apart (`src/geometry/layout.ts`). Shared and external walls are detected from the plan. Walls of different rooms that continue one straight line on the plan (an outside wall running past the living and dining rooms, say) are kept flush, so when measurements and the plan disagree, the difference goes into the thickness of internal walls, not into a step in a straight wall.
- **Areas.**
  - *Net* is the sum of the room interiors.
  - *Built-up* is the union of all rooms, each grown by the wall thickness it owns: half of an internal wall, and all of an external wall. **Settings** lets you count external walls at 100%, 50% or 0%, because developers measure this differently.
- **Facing.** Once north is set, a room faces the directions of its outside walls, walls onto a balcony, and open sides with nothing beyond (`src/geometry/facing.ts`). The plan can't tell open air from the next unit or a corridor, so in the **North** tool the outside walls are coloured by direction. Tap any that are really against the next unit, a lobby or a corridor to rule them out (also on each wall's Measure step).
- **Aircon.** Area (ft²) × 60 BTU/h × (ceiling height ÷ 2.7 m), plus 10% for rooms with afternoon sun. A room gets the sun margin automatically when it faces SW, W or NW; you can override it per room in Measure. The result is rounded up to a standard 1.0, 1.5, 2.0 or 2.5 HP unit. If a room already has a unit (set **Aircon already installed** on the Plan tab or the room's Measure step), the report checks it instead: green if it covers the estimate, allowing the estimate to be up to 10% above its rating (adjustable in Settings), red if it may be too small. The units in all rooms of an aircon zone add up. This is a Malaysian rule of thumb: use it for budgeting, and confirm with the installer.

## Known limits / next ideas

- Wall angles come from the plan, so a room that is out of square isn't detected. Measuring the diagonals would fix this.
- Rescaling uses one scale for the whole plan, so a plan stretched more one way than the other is only half corrected.
- Room tracing is manual. A vision model could draft the rooms for you to correct.
- Plans in PDF format need converting to an image first.
- Laser measure over Bluetooth (Bosch/Leica) works on Android Chrome only.
- Only one user; there are no accounts.
