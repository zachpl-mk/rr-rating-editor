# RRRating Editor

Static browser tool for viewing and editing Retro Rewind's `RRRating.pul` rating file.

Open `index.html`, import `/RRRating/RRRating.pul` from your SD card or Dolphin NAND, edit the VR/BR per profile, then download the regenerated file and put it back in the same place.

## File format

All values are big-endian. Layout matches `PulsarEngine/IO/RRRating.hpp`.

| Offset | Size | Field |
| --- | --- | --- |
| `0x000` | 4 | Magic `RRRT` |
| `0x004` | 2 | Version (`2`) |
| `0x006` | 2 | Entry capacity (`100`) |
| `0x008` | 100 × 12 | Entries: `u32 pid`, `u32 vr`, `u32 br` (`pid = 0` is an empty slot) |
| `0x4B8` | 8 | Pending race marker: `u32 pid`, `u32 penalizedVR` |

- Ratings are stored as raw points, valid from `1` to `1000000`.
- Legacy version 1 files (`1608` bytes, float ratings) are converted on import the same way the game migrates them.
- Profiles are entered by friend code; the profile ID is its low 32 bits, and the checksum is verified before the code is accepted.
- **Get VR** (per row) and **Get all VR from leaderboard** fill the VR field from `https://rwfc.net/api/leaderboard/player/{friendCode}`.