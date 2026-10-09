# Traceformers Terminal

A terminal-style dapp on top of [Trace](https://opensea.io/collection/traceart), the onchain ASCII collection by 0xvesty. Characters speak with glyphs from their own grid, encoders hide the line in a dialect, and bases open the key of a thread. A conversation only counts when it closes, and every step is an EIP-712 signature: no transaction, no gas.

Live: https://cappuccinoalcioccolato.github.io/traceformers-terminal/

Unofficial. It references real Trace token ids, traits, and art, and never mutates them.

## What you can do

- **Wall**: the public stream. Every line shows only its ciphertext. Blink lines decay after one block, lines without a base stay sealed, and replies cluster under the line they answer. Click any line to open its talk.
- **Talk**: a floating window, from any view: the art of the four pieces, their holders, and who brought the base and the encoder, who answered which `#`, the encoded lines, state and points. Export it as a PNG with the same visuals (no points), or share it on X: the post tags every holder that added an X username, with the pieces each one brought, and stays within 280 characters.
- **Terminal**: connect, sign in once, and receive 2 characters, 3 bases (classic, inverted, blink), and 3 encoders (binary, base64, punched card). Pick the character that speaks, compose from its own glyphs, then:
  - **open +base** or **open +encoder**: bring one piece and leave the other slot empty. The answer arrives on its own, from a network character or from your other character.
  - **complete**: your character brings both a base and an encoder. Another character answers with itself only, at a lower weight.
  - **answer**: reply to an open conversation; if a slot is empty, fill it with your own piece, an idle piece, or a draw from the idle pool.
  - Both characters of a talk speak through the same base and encoder; the talk shows who brought each one.
  - The base and encoder lists follow the mode: a slot left to whoever answers, or already filled by the opener, is not selectable.
  - **open key** on one of your bases lets you read its talks for 12 blocks (blink: 1). No points move.
  - Plaintext appears only in your terminal, and only while a base of that talk keeps the key open.
- **Graph**: every closure as a network of characters, bases, encoders, and holders. Click a node, pick a role and type its `#`, or search a holder by address, name, or @handle, to focus it and see the NFT, its traits, its OpenSea page, and its closures. The log below follows the focus, pages by 25, and draws your transactions in red; each row opens its talk.
- **Pool**: idle offers. Sign an offer (max uses, expiry, and optionally the only characters that may use it), revoke it, or delegate a piece to another address inside the registry (not a sale, not an Ethereum transfer).
- **Board**: points by wallet or by NFT for each role. Your row is drawn in red; outside the top 10 your rank is pinned under a `[…]` row.
- Each page has its own short guide under the tabs, folded until you open it.

## Rules in this version

| Event | Opening character | Answering character | Base | Encoder |
| --- | --- | --- | --- | --- |
| Targeted: the opener brings one piece, another holder the other | 3 | 3 | 1 | 1 |
| Complete: the opener brings both pieces, another holder answers | 1 | 1 | 1 | 1 |
| Self: the answering character is held by the opener's own wallet | 1 | 0 | 1 | 1 |

- Every talk gets an answer: the network answers any opening that has waited 3 blocks, never from the opener's own wallet.
- An opening brings a base, an encoder, or both, and may wait 2 minutes to 2 hours.
- Only the holder at inclusion time can sign; after a delegation, earlier signatures on that piece stop counting.
- Idle offers stand until revoked, with an optional cap on uses, an optional expiry, and an optional list of the only characters allowed to use them.
- Another character of the same wallet may answer, but that answer earns nothing.
- The draw from the idle pool uses a relayer seed published with the closure, standing in for Chainlink VRF. If the pool is empty, offers are not consumed.
- Each piece cools down for 3 blocks after it acts. A block is 6.5 seconds.

## How it runs

This build is fully static, so it can be served by GitHub Pages. The relayer runs in the browser: it verifies every EIP-712 signature with [viem](https://viem.sh), keeps the registry in `localStorage`, and moves the network forward block by block. Six demo holders (keys derived from public labels, not secrets) sign their own openings, answers, and idle offers through the same checks as you.

Consequences: each browser has its own registry, and nothing is shared between visitors yet. Use **reset local registry** in the footer to start over from genesis.

Sign-in uses a wallet signature (`LinkWallet`), with an EIP-6963 browser wallet or a session wallet whose key stays in the browser. Signing in with X needs a server and is not part of the static build; instead, you can type your X username in the wallet panel so shared talks tag you. The six network holders have no X accounts, so posts name them by label and never tag anyone at random.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173/traceformers-terminal/
npm run build    # static output in dist/
```

`BASE_PATH` overrides the base path for hosts other than GitHub Pages, for example `BASE_PATH=/ npm run build`.

## Code map

- `src/lib/trace/`: the real Trace catalog, the real 35×21 glyph grid of each character (rebuilt from its art by `scripts/extract-grids.mjs`), and the dialect ciphers.
- `src/lib/protocol/`: the EIP-712 domain and types, the relayer, the network holders, and the derived graph and rankings.
- `src/lib/store.ts`: app state, persistence, the block loop, and the signed actions.
- `src/components/`: the wall, talk, terminal, graph, pool, board, info drawer, and wallet sheet.

## Origin

The project merges two earlier prototypes: the terminal wall MVP (characters speaking, encoders, bases, automatic answers, PNG export) and a later integration that added the signature protocol, the graph, the idle pool, and the leaderboard. This repository keeps the MVP's look and basic interaction and builds the integration's protocol into it.
