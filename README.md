# Traceformers Terminal

A terminal-style dapp on top of [Trace](https://opensea.io/collection/traceart), the onchain ASCII collection by 0xvesty. Characters speak with glyphs from their own grid, encoders hide the line in a dialect, and bases open the key of a thread. A conversation only counts when it closes, and every step is an EIP-712 signature: no transaction, no gas.

Live: https://cappuccinoalcioccolato.github.io/traceformers-terminal/

Unofficial. It references real Trace token ids, traits, and art, and never mutates them.

## What you can do

- **Wall**: the public stream. Every line shows only its ciphertext. Blink lines decay after one block, lines without a base stay sealed, and replies cluster under the line they answer. Click any line to open its talk.
- **Talk**: who opened, who answered which `#`, which base and encoder were used, the state and points. Export it as a PNG.
- **Terminal**: connect, sign in once, and receive 2 characters, 3 bases (classic, inverted, blink), and 3 encoders (binary, base64, punched card). Pick the character that speaks, compose from its own glyphs, then:
  - **open +base** or **open +encoder**: bring one piece and leave the other slot empty. The answer arrives on its own, from a network character or from your other character.
  - **complete**: character, base, and encoder in one signature. Closes at once, at a lower weight.
  - **answer**: reply to an open conversation with your own piece, an idle piece, or a draw from the idle pool.
  - Plaintext appears only in your terminal, and only while a base of that talk keeps the key open.
- **Graph**: every closure as a network of characters, bases, encoders, and holders. Click a node to focus it and see the NFT, its traits, its OpenSea page, and its closures. The log below is clickable.
- **Pool**: idle offers. Sign an offer (max uses, expiry, excluded characters), revoke it, or transfer a piece inside the registry.
- **Board**: points by wallet or by NFT for each role. Your row is drawn in red; outside the top 10 your rank is pinned under a `[…]` row.

## Rules in this version

| Event | Opening character | Answering character | Base | Encoder |
| --- | --- | --- | --- | --- |
| Targeted conversation closed | 3 | 3 | 1 | 1 |
| Complete offer closed | 1 | — | 1 | 1 |
| Expired | 0 | 0 | 0 | 0 |

- An opening leaves exactly one slot empty and waits 2 minutes to 2 hours.
- Only the holder at inclusion time can sign; after a transfer, earlier signatures on that piece stop counting.
- Idle offers stand until revoked, with an optional cap on uses and an optional expiry.
- Another character of the same wallet may answer.
- The draw from the idle pool uses a relayer seed published with the closure, standing in for Chainlink VRF. If the pool is empty, offers are not consumed.
- Each piece cools down for 3 blocks after it acts. A block is 6.5 seconds.

## How it runs

This build is fully static, so it can be served by GitHub Pages. The relayer runs in the browser: it verifies every EIP-712 signature with [viem](https://viem.sh), keeps the registry in `localStorage`, and moves the network forward block by block. Six demo holders (keys derived from public labels, not secrets) sign their own openings, answers, and idle offers through the same checks as you.

Consequences: each browser has its own registry, and nothing is shared between visitors yet. Use **reset local registry** in the footer to start over from genesis.

Sign-in uses a wallet signature (`LinkWallet`), with an EIP-6963 browser wallet or a session wallet whose key stays in the browser. Signing in with X needs a server and is not part of the static build.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173/traceformers-terminal/
npm run build    # static output in dist/
```

`BASE_PATH` overrides the base path for hosts other than GitHub Pages, for example `BASE_PATH=/ npm run build`.

## Code map

- `src/lib/trace/`: the real Trace catalog, the 35×21 glyph grid dressed by each character's traits, and the dialect ciphers.
- `src/lib/protocol/`: the EIP-712 domain and types, the relayer, the network holders, and the derived graph and rankings.
- `src/lib/store.ts`: app state, persistence, the block loop, and the signed actions.
- `src/components/`: the wall, talk, terminal, graph, pool, board, info drawer, and wallet sheet.

## Origin

The project merges two earlier prototypes: the terminal wall MVP (characters speaking, encoders, bases, automatic answers, PNG export) and a later integration that added the signature protocol, the graph, the idle pool, and the leaderboard. This repository keeps the MVP's look and basic interaction and builds the integration's protocol into it.
