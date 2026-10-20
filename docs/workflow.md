# Workflow

How to use each tab, in the order you'd usually go through them. The screenshots show a made-up two-bedroom apartment. Back to the [README](../README.md).

## 0. Layouts

Create one layout per apartment you're checking. You can switch between them from the name at the top left.

## 1. Plan

Easier on a laptop.

![The Plan tab](../samples/plan.png)

- Upload the plan image.
- **Set scale**: tap both ends of a printed dimension, such as the 12300 line, and enter its real length.
- **Draw room**: trace each room along the *inside* faces of its walls. Corners snap to straight lines and line up with other rooms' corners. Mark boundaries with no wall (open plan) as **Open**.
- Set each room's type, put open-plan spaces in a shared **aircon zone**, and note any aircon that's already installed.
- **North** (optional): turn the dial until its needle matches the plan's north arrow, or type the bearing in degrees. With no arrow on the plan, use Google Maps to see which way the windows face. The app then knows which way each room faces.

## 2. Measure

On site, on your phone.

![The Measure tab](../samples/measure.png)

- For each room, enter the ceiling height, then go wall by wall from corner A to corner B. The plan's estimate is shown, and a reading more than 8% (or 150 mm) off it is flagged.
- You can skip a wall you can't reach. It is worked out from the other walls.
- Optionally enter the wall thickness (measure it at a door frame) and the doors and windows on each wall.
- Add any **pillars** standing out from a wall: their width along the wall, how far they stand out (depth), and whether they're in corner A, corner B or somewhere along the wall (then how far from corner A). One in a corner stays in that corner when the wall's length changes. The floor a pillar stands on is left out of the room's area, and it's drawn as solid as the walls on the 2D and 3D tabs. Measure the walls as if it weren't there: up to the pillar, plus how far it runs along that wall (the wall step reminds you when a pillar is in the way).
- **Rescale** if the plan isn't to scale. Brochure plans often aren't quite to scale. Once you've measured 3 or more walls, the room list tells you if they come out consistently longer or shorter than the plan (by 1% or more), and **Rescale the plan to match** fits the scale to them. Any wall you skipped then gets a better estimate. The same option is under **Set scale** on the Plan tab, with **Undo** straight after.
- If the plan is wrong in places rather than just the wrong size, untick **Plan image** above the plan (Plan, Measure, 2D or 3D) to hide it for this layout.

## 3. Electrical

Plan where the lights, ceiling fans and plug points go on the measured floor plan. Pick **Downlight**, **Surface light** (mounted on the ceiling rather than set into it), **Eyeball**, **Pendant**, **LED tube** or **Fan** above the plan, then tap inside a room to place one. Keep tapping to place more. A new eyeball aims at the nearest wall, an LED tube runs along it, a linear pendant runs the long way of the room, and a fan is sized for the room's floor area (e.g. 42″ up to 13.5 m², 48″ up to 21 m²).

![The Electrical tab](../samples/electrical.png)

- Tap a light or fan to select it. Drag to move it: it lines up with other lights and fans and with the middle of each room (hold Shift to place it freely). Dashed lines show how far it is from each wall (for a fan, from its blade tips). Drag the dot at an eyeball's arrow to aim it, or either end of a pendant or LED tube to change its length and direction. Delete or Backspace removes the selected one.
- A fan is drawn at its blade sweep, and you can pick another standard size (36″ to 60″). You're warned if the blade tips come within 450 mm of a wall.
- Set each one's **Power** (watts; for LED tube, watts per tube) and **Colour temperature** (2700K to 6500K, or tri-colour). A downlight's or eyeball's **Size** is its ceiling cut-out, a surface light's is across the fitting, and a round pendant's is across its shade; round fittings are drawn at that size once you zoom in far enough. A fan's **Light** is the colour of its light kit, if it has one.
- An LED tube is a run lit by tubes end to end: pick the **Tube** size (1ft to 5ft, 4ft to start) and it works out how many you need, rounding up because a tube can't be cut (the last one overlaps). A run up to 5% of a tube longer than whole tubes doesn't take another, as the ends can sit just short. For example, a 2,960 mm cove takes 3 × 4ft tubes, or 5 × 2ft. On the plan it's labelled with the count, e.g. `3×16W`.
- Note each one's **Model** (the light, bulb or fan's brand and model) for the report; it isn't drawn on the plan. Models you've already used are offered as you type.
- A new light starts with the model, size, power and colour of the last one of its kind you placed. **Use for all** copies the selected one's model and settings to every light of its kind.
- With **Watt & temp** ticked, each light is labelled with its power and colour temperature (e.g. `12W 3000K`), placed clear of other lights, labels and room names, and inside the room where it fits.
- The panel keeps a schedule: how many of each light and fan every room has, how many LED tubes, and the watts in all (with a `+` where some have no power set yet).
- Each one is stored relative to the centre of its room, so it keeps its place as measurements change the room's size. They also show on the 2D tab, with the same labels.
- **Plug points**: pick **Existing plug** to mark one that's already there, or **New plug** for one to add, then tap inside a room by the wall: it goes on the nearest wall (not an open side). Each shows as a badge just inside the room with how many sockets it has, e.g. `[2]` for a twin socket: outlined grey for existing, filled red for new. Set the **Sockets** (1 to 6) and switch between **Existing** and **New** on the selected one; a new one starts with as many sockets as the last one placed. Add a short **Remark** (up to 25 characters) for what it's for (e.g. TV, oven); it's shown beside the badge, as in `[2] TV`, and in the report. On the plan a remark goes beside its badge, away from the wall, or else on the line under or over it, wherever it stays inside the room and clear of room names, lights and other plug points; a long one wraps onto two lines (at a comma or space) where one line won't fit. Remarks you've used and common ones are offered as you type. A point can also go on a pillar's face. Drag it along its wall, round a corner onto the next wall, or across a wall into the next room. Dashed lines show how far it is from each end of the wall (or of the stretch beside a pillar, or of the pillar's face), and you're warned if it's in a doorway (or an opening down to the floor) on either side of the wall.
- The panel keeps a second schedule for plug points: the sockets in each room, existing and new, and the new points by how many sockets each has. Plug points show on the 2D tab too (untick **Plug points** to hide them), and wall lengths slide along the wall to keep clear of them.

## 4. Cabinets

Plan built-in cabinets (kitchen cabinets, wardrobes, vanities) wall by wall. Each one stands along a wall of a room, all of it or part of it, and can turn an inside corner onto the next wall (an L) and the one after (a U). They show on the 2D tab too (untick **Cabinets** to hide them), but not yet on the 3D tab.

![The Cabinets tab](../samples/cabinets.png)

- **New cabinet**, then tap the wall it goes along on the plan. It starts along all of that wall, as what the room usually has: a base cabinet in a kitchen, a wardrobe in a bedroom, a vanity in a bathroom, a tall cabinet in a utility room. Its finishes and handles are the last cabinet's.
- Then a step at a time (tap a step at the top to jump to it). **Delete**, beside the cabinet's name on every step, removes it, e.g. one added on the wrong wall by mistake:
  1. **Walls**: while you're setting up a new cabinet, tap the wall just past either end to turn the corner onto it, or an end wall again to take it off; tap any other wall to move the cabinet there (compartments you've changed come along). Once you've left this step, taps on the plan don't move it, so a stray tap can't: tap **Change walls** first, and **Done changing walls** after. Tapping another cabinet on the plan opens it. Set where it **starts** (from the first wall's left corner as you face it, marked on the plan) and its **length** along its last wall (blank runs to the corner). The walls are numbered as on the Measure tab, and their lengths come from your measurements. At each corner, a front loses the depth of the other leg: that corner square is reached only from the first.
  2. **Type**: base, wall, tall, wardrobe, vanity or other, and a template, each previewed on this cabinet's walls: e.g. **Sink & hob** (drawers and a sink at the left, doors, drawers under a hob at the right, or on the last wall of an L or U), **Lift-up doors**, **Oven tower**, **Sliding doors**, **TV console**. A template sets the usual sizes, compartments and cut-outs.
  3. **Size**: the carcass height and depth, whether it stands on a plinth, on legs or is hung (and how high), and the board thickness. **Up to the ceiling** fills the height for a tall cabinet, wardrobe or wall cabinet.
  4. **Compartments**: the cabinet from the front, its walls unfolded side by side. Tap a compartment to set its front (doors, drawers, open, an appliance space or a fixed panel), how its doors open (left, right, a pair, lift-up or sliding), a **fixed panel** on one side of hinged doors where there's only room for that side to open (half the compartment unless you size it; the door then hinges on the far side, and the shelves still run the full width), its shelves and a hanging rail, or to divide it side by side or one above another. Drag the line between two compartments to resize them, or type a size. A compartment with no size shares what the others leave, so it grows or shrinks with the cabinet. **Show inside** draws the shelves and rails behind the doors.
  5. **Top & sink** (base cabinets, vanities and others): quartz, granite, marble, sintered stone, solid surface or laminate; its thickness, overhang and upstand; and cut-outs for a sink, hob or basin, sized from its spec sheet and centred over a compartment. The view from above shows the top's shape and its cut-outs, and the walls behind it with their windows (hover one for its width and sill), doorways as gaps, and any pillar against those walls or in the cabinet's way.
  6. **Finish**: a name or code and a colour for the fronts, the carcass and the top. Finishes used on other cabinets are offered.
  7. **Review**: a summary, what to check, and what it takes to build. **Duplicate** copies it to put on another wall.
- Things to check are listed as you go: a cabinet running past the end of its wall, across a doorway, over a window (or a window sill below the top), into a pillar, above the ceiling; doors over 600 mm wide (beside a fixed panel, what the panel leaves; sliding ones over 1,200 mm), drawers over 1,000 mm wide; a sink over drawers or an appliance, a cut-out wider than the compartment under it or running past the end, or with less than 50 mm of stone in front.

## 5. Furniture

Plan the loose furniture and appliances (a sofa, the beds, the fridge) and keep track of buying them. Pick **New item** above the plan, then tap where it goes in a room, and type its name. Each item has an optional **Model**, **Link** (where to see or buy it; one typed without `https://` gets it added), **Width**, **Depth** and **Height**, and a **Reference price** in RM, and a **Status**: pending (still to order), ordered, or delivered.

![The Furniture tab](../samples/furniture.png)

- On the plan each item is a diamond where it goes: hollow when pending, blue once ordered, green with a tick once delivered. Its card, with its name, price, model and size, sits in a column beside the plan, on the side nearer it, with a dotted line to the diamond, so the plan itself stays clear. The cards go level with what they point to where there's room, and are stacked so they don't overlap and their lines don't cross.
- Several items can share a spot, e.g. a TV on its console: with **New item**, tap the diamond that's there (or **Add another here** on an item). The spot then shows how many, with one dotted line to its cards, bracketed together. Tap the diamond again to go through them.
- Tap a diamond or a card to open the item. Drag a diamond to move it (with everything at that spot), into another room if you like; drop it on another diamond to share that spot (hold Shift to place it freely). To move one item away from a shared spot, select it and drag its card. Delete or Backspace removes the selected one.
- The panel lists everything room by room, with how many are pending, ordered and delivered and what each comes to (with a `+` where some have no price yet). Items also show on the 2D tab (untick **Furniture** to hide them) and in the report.

## 6. 2D

A read-only floor plan drawn from your measurements: solid walls (and pillars) cut at 1.2 m, windows, door gaps, room names and areas, and each wall's length (as measured, or `≈` the worked-out length for a wall you skipped). Pinch or scroll to zoom. To turn the plan, twist with two fingers, drag with the right mouse button (or Shift-drag), or use the ↺ ↻ buttons. It snaps square near each quarter turn. With north set, **North up** turns north to the top. **Measure** gives the length between any two points: tap one, then the other, and the length shows on the plan and below it. It works from the plan's scale, in your length unit. A point snaps to a room corner, a wall end or a cabinet corner nearby, or else onto a wall face or a cabinet's edge; a second point nearly straight across or along from the first is made exactly straight, so tapping one wall then the opposite one measures straight across. Hold Alt to place a point anywhere. Tap again to start a new measurement; **Clear** or Esc removes it, and Esc again (or **Measure**) stops measuring. **Cabinets** draws the planned cabinets from above, in their finish colours: a base cabinet as its top, with any sink, hob or basin in it; a tall cabinet or wardrobe, which the 1.2 m cut goes through, outlined heavier and crossed; and a wall cabinet, above the cut, dashed over whatever is under it. **Furniture** draws each item's diamond and its card beside the plan, as on the Furniture tab, upright however the plan is turned. A **Legend** at the top left names each kind of light and fan, existing and new plug points, each kind of cabinet, and each furniture status on the plan; it follows the **Lights & fans**, **Plug points**, **Cabinets** and **Furniture** checkboxes. Tap **Legend** to fold it away (it starts folded on a phone); open, the plan is fitted beside it.

![The 2D tab](../samples/2d.png)

## 7. 3D

Orbit around the model, cut the walls at 1.2 m to see the layout, and show the plan image underneath. Inside walls are drawn in the paint colour set in **Settings → Paint** (a hex code such as `#c8d8c0`). To give one wall a different colour, open **Paint** on that wall's Measure step. The outside of the unit stays off-white.

![The 3D tab](../samples/3d.png)

## 8. Report

Net area, estimated built-up area, a comparison with the advertised area, a per-room table, aircon sizing, a lighting and fan list, plug points, cabinets, furniture and appliances, and a CSV export. The lighting list groups lights that match in type, model, size, power and colour, with how many there are (for LED tube, the tubes to buy and the runs they light), which rooms they go in, and their watts. The plug points list shows each room's existing and new points as their badges with their remarks, the points and sockets in all, and the new points by size (for the electrician's quote). Each cabinet is drawn from the front and from above, with what to check, and then the materials for all of them. The furniture and appliances table lists each item room by room with its model, size, room, price, status and link, then how many are pending, ordered and delivered and the prices in all.

![The Report tab](../samples/report.png)
