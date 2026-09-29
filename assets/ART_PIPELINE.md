# Generated art pipeline

All visible game art in the badminton court is generated image art, then postprocessed into runtime frames with the `generate2dsprite` skill.

- `background/court-realistic.svg` — indoor badminton court background with windows, wood floor and court lines
- `background/court.png` — legacy generated court source
- `processed/player-idle` — mint kit idle frames
- `processed/player-coral` — coral kit idle frames
- `processed/player-sky` — sky kit idle frames
- `processed/player-swing` — forehand swing frames
- `processed/opponent-idle` — opponent idle frames
- `processed/opponent-swing` — red opponent attack frames
- `processed/shuttle` — shuttlecock frames

The runtime displays the processed player/shuttle frames and the SVG court background. The same frame-specific hand and racket-head points drive both the draw pass and swept collision, so the visible racket stays attached to the hitbox.
