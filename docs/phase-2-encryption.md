# Phase 2 brainstorming: encryption from the code inside the NFTs

Status: open brainstorming, not a spec. Date: 9 October 2026. Scope: how Traceformers Terminal could encrypt talks with the code the Trace tokens are made of, instead of the placeholder dialects of phase 1.

## 1. Where phase 1 stands

The three encoders are dialects, not encryption. Base64 and binary are reversible encodings of the glyphs; anyone who knows the method reads them. Punched card is a one-way hash pattern: nobody reads it, not even the holders. Privacy is a rule of the app: the plaintext lives only in the browser of whoever wrote it, and the terminal shows it only to holders of a seated piece while the base of that side keeps its key open.

Traits already in use: the character's art defines the glyphs it may speak, the encoder's Method sets the dialect, and the base's Form sets the key window (classic and inverted 12 blocks, blink 1). Palette, Motion, and the encoder's Form have no role yet.

Every signed line already carries a commitment, `keccak256("traceformers:" + plaintext)`, inside the EIP-712 Open and Answer messages. Phase 2 can build on that: the commitment proves later what was said without revealing it now.

## 2. What is inside the NFTs

### Characters: verified

A decoded character is an SVG of pure code: a `43155 × 43008` viewBox, background `#ededed`, ink `#141410`, five glyph shapes declared once as `<path>` definitions (`g1` to `g5`), and a few hundred `<use>` placements on a grid of 35 columns by up to 21 rows (cell `1233 × 2048` units). `scripts/extract-grids.mjs` rebuilds that grid exactly.

The five shapes are the same in all 18 characters of the catalog. By ink coverage they map to a shade ramp:

| Shape | Ink coverage | Glyph |
| --- | --- | --- |
| g1 | 3% | `.` |
| g3 | 13% | `░` |
| g2 | 20% | `▒` |
| g4 | dark, cut pattern | `▓` |
| g5 | 100%, one rectangle | `█` |

So the alphabet is shared and the composition is unique. Each character is a fingerprint of counts and positions:

| Character | `.` | `░` | `▒` | `▓` | `█` | inked cells | blank cells |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #0002 | 9 | 116 | 110 | 132 | 0 | 367 | 368 |
| #0004 | 0 | 183 | 66 | 103 | 4 | 356 | 379 |
| #0005 | 4 | 171 | 160 | 18 | 0 | 353 | 382 |
| #0007 | 3 | 198 | 89 | 97 | 0 | 387 | 348 |
| #0009 | 10 | 113 | 162 | 30 | 0 | 315 | 420 |
| #0012 | 25 | 149 | 117 | 93 | 0 | 384 | 351 |
| #0013 | 5 | 150 | 161 | 86 | 13 | 415 | 320 |
| #0014 | 8 | 117 | 152 | 52 | 1 | 330 | 405 |
| #0015 | 2 | 124 | 86 | 150 | 0 | 362 | 373 |
| #0019 | 7 | 154 | 148 | 64 | 0 | 373 | 362 |
| #0021 | 40 | 146 | 144 | 31 | 3 | 364 | 371 |
| #0025 | 9 | 75 | 80 | 169 | 6 | 339 | 396 |
| #0027 | 2 | 263 | 89 | 108 | 0 | 462 | 273 |
| #0028 | 0 | 192 | 66 | 98 | 1 | 357 | 378 |
| #0029 | 1 | 182 | 71 | 73 | 1 | 328 | 407 |
| #0030 | 60 | 135 | 69 | 54 | 0 | 318 | 417 |
| #0031 | 11 | 168 | 106 | 106 | 6 | 397 | 338 |
| #0033 | 7 | 200 | 80 | 133 | 0 | 420 | 315 |

### Bases and encoders: not inspected yet

This repository only holds 500 × 500 PNG previews of the bases and encoders, taken from the marketplace. Their source code is not in hand. The first task of phase 2 is to read `tokenURI` from the Trace contract (`0x691bd9fd56fdd24831b3c3068d4a10ec00341e40`) for a few bases (Classic, Inverted, Blink) and encoders (Binary, Base64, Punched card; Classic, Wave, Glitch, Scatter) and see what the code is: SVG, HTML with script, or an onchain renderer with parameters.

## 3. The constraint that shapes everything

Code that is public is not a secret. Anything derived only from token data (the SVG, the traits, the tokenId) can be recomputed by anyone who reads the chain. A cipher keyed only by the NFTs would look secret and be open.

So the split proposed here:

- The NFT code decides how: the alphabet, the layout, the transform, the timing. That is what makes each talk look and behave like its pieces.
- The holders decide who: the secret comes from the wallets seated in the talk, never from the art alone.

## 4. Building blocks

### A. The character grid as a codebook

A character speaks by pointing at its own face. Each plaintext glyph becomes the coordinates of a cell that holds that glyph in the speaker's grid. Most glyphs appear in many cells (`░` 146 times in #0021), so each one can be written many ways: a homophonic code. A key picks which occurrence to use, which flattens glyph frequencies and hides repeats. Rare glyphs (`█` 3 times in #0021) are rare words: the character can say them only a few ways, which is a trait-driven texture, not a flaw.

### B. The encoder code as the transform

The Method keeps choosing the family of the ciphertext (bits, base64, punched holes). The encoder's own code (or its Form trait: Classic, Wave, Glitch, Scatter) defines a permutation or a diffusion step: hash the encoder's code and use it to shuffle the coordinates from block A. Motion (Static, Animated) could make the ciphertext re-render every block on the wall while the meaning stays fixed.

### C. The base code as the key schedule

The base already sets the key window. Its code could become the salt of the key derivation: `salt = keccak256(base code)`. Form keeps setting time: Blink becomes a one-block key, so a blink talk is readable for one block and then gone for good. Palette (Light, Dark, Grey) could pick a key rotation or a reading mode.

### D. Real secrecy from the seats

Every seat is already an EIP-712 signature, and a signature reveals its signer's public key. That gives a real encryption layer with no extra step from the holders:

1. The speaker's client draws a random content key and encrypts the line with AES-GCM (WebCrypto).
2. It derives the wrapping keys with HKDF, salted with the base code (block C) and labelled with the talk id and side.
3. It wraps the content key for the public key of every holder seated in the talk (ECIES on secp256k1, the curve of Ethereum wallets).
4. Only the ciphertext, the wrapped keys, and the commitment go public. Any seated holder decrypts locally; nobody else can.

Open choice: when a piece is delegated, does the new holder read the old lines (re-wrap) or only the new ones (forward secrecy)?

### E. Commit and reveal

The line commitment already signed in phase 1 lets a holder reveal a plaintext later and prove it was the one spoken. That could become a game mechanic: a talk stays sealed until both characters choose to reveal it.

## 5. Two tracks, used together

- Art cipher (blocks A to C): visible, playful, driven by the NFT code. It makes every talk look like its pieces, but it is not secure on its own.
- Sealed layer (block D): real cryptography, keyed by the seated holders' wallets.

Proposal: the wall shows the art cipher; the plaintext travels only inside the sealed layer. The NFTs give the language its shape; the holders give it its privacy.

## 6. Open questions

- What exactly is the onchain code of bases and encoders, and is all of it onchain?
- Should the art cipher be reversible by anyone who reads the code (a public language, like phase 1) or only with the sealed key?
- Do holders accept a signature that is also a public-key reveal? Most wallets already expose it through any signature, but it should be said clearly.
- Delegation: re-wrap old lines for the new holder, or keep them sealed for the previous one?
- Blink: is a one-block key a feature (ephemeral talk) or a frustration?
- Where do ciphertext and wrapped keys live when the relayer leaves the browser: onchain events, IPFS, or an indexer?
- 0xvesty's view: Trace is his work. The cipher should read the code without changing it, and ideally with his blessing.

## 7. Next experiments

1. Read `tokenURI` for three bases and three encoders and document their code structure in this file.
2. Measure how much variety each character grid offers as a codebook (positions per glyph, rare glyphs).
3. Prototype block A: encode a line as coordinates in the speaker's grid and render it on the wall.
4. Prototype block D: AES-GCM plus ECIES wrapping with the public keys recovered from the seat signatures, using viem and WebCrypto in the browser.
5. Decide the UX of a sealed line for a reader without access: noise, the art cipher, or nothing.

## 8. Out of scope for phase 2

- Changing the Trace contract, the renderer, or the art.
- A new token, fees, or anything that moves the NFTs.
- Moving the relayer to a server: that is a separate decision.
