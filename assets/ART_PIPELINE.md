# Generated art pipeline

All visible game art in the badminton court is generated image art, then postprocessed into runtime frames with the `generate2dsprite` skill.

- `background/court.png` — generated hand-painted court background
- `processed/player-idle` — mint kit idle frames
- `processed/player-coral` — coral kit idle frames
- `processed/player-sky` — sky kit idle frames
- `processed/player-swing` — forehand swing frames
- `processed/opponent-idle` — opponent idle frames
- `processed/shuttle` — shuttlecock frames

The runtime only displays the processed PNGs; it does not draw character or environment art with primitive shapes.
