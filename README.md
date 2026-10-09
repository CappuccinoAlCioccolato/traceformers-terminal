# Traceformers Terminal

A terminal-style dapp on top of [Trace](https://opensea.io/collection/traceart), the onchain ASCII collection by 0xvesty. Characters speak with glyphs from their own grid, encoders hide the line in a dialect, and bases open the key of a thread. A conversation only counts when it closes, and every step is an EIP-712 signature: no transaction, no gas.

Live: https://cappuccinoalcioccolato.github.io/traceformers-terminal/

Unofficial. It references real Trace token ids, traits, and art, and never mutates them.

## How a talk works

A talk has two sides of three seats each: a **character** that speaks, an **encoder** that hides its line, and a **base** that holds the key.

1. A character opens the **talk side**. Its holder can bring their own base and encoder, or leave either seat empty.
2. Empty seats go to the **waiting room**. Any holder of a base or an encoder can take one with a signature (`Join`). No character is needed.
3. Once the talk side has all three pieces, its line is encoded and the **answer side** opens. Another character answers and cites the talk's `#`. Its base and encoder can come from its own holder or from anyone in the waiting room. The answer encoder must speak the same dialect as the talk encoder.
4. When all six seats are taken, the talk closes. If a seat waits too long, a network holder or an idle piece from the pool fills it, so every talk closes.

## What you can do

- **Wall**: the public stream of ciphertext. Blink lines decay after one block, lines whose side has no base stay sealed, and answers cluster under the talk they answer. Click any line to open its talk.
- **Waiting room** (on the wall): the empty seats of open talks, split into talks and answers. For each seat it lists your pieces that fit and joins with one click and one signature.
- **Terminal**: connect and sign in once to receive 2 characters, 3 bases (classic, inverted, blink), and 3 encoders (binary, base64, punched card). Pick the character that speaks, compose from the glyphs of its own art, then **talk** or **answer**, bringing your base and encoder or leaving the seats to the waiting room. Without a character, the terminal points you to the waiting room and the pool.
- **Talk**: a floating window, from any view: both sides with the art of each piece, its holder, how it took its seat, and its points, then the encoded lines. Export it as a PNG with the same visuals, or share it on X: the post tags every holder that added an X username, with the seats it took, and stays within 280 characters.
- **Graph**: every closure as a network of characters, bases, encoders, and holders. Click a node, pick a role and type its `#`, or search a holder by address, name, or @handle, to focus it and see the NFT, its traits, its OpenSea page, and its closures. The log below follows the focus, pages by 25, and draws your transactions in red.
- **Pool**: idle offers. One signature lets the relayer seat your base or encoder in talks that wait (max uses, expiry, and optionally the only characters that may use it). Revoke it, or delegate a piece to another address inside the registry (not a sale, not an Ethereum transfer).
- **Board**: points by wallet or by NFT for each role. Your row is drawn in red; outside the top 10 your rank is pinned under a `[…]` row.
- Each page has its own short guide under the tabs, folded until you open it.

## Rules in this version

| Seat | Points when the talk closes |
| --- | --- |
| Talk character, answer character | 3 each |
| Talk base, talk encoder, answer base, answer encoder | 1 each |
| Self-answer: the answering character is held by the talk's own wallet | talk character 1, that wallet's answer seats 0 |

- A talk may wait 2 minutes to 2 hours. The network answers after 3 blocks, takes empty seats after 4, and the pool fills them after 5.
- Only the holder at inclusion time can sign. After a delegation, the piece leaves every seat of every open talk.
- Idle offers stand until revoked, with an optional cap on uses, an optional expiry, and an optional list of the only characters allowed to use them.
- Each piece cools down for 3 blocks after it takes a seat. A block is 6.5 seconds.

## How the encoding works

The encoders are dialects, not encryption. **Base64** and **binary** are reversible encodings of the glyphs, and **punched card** is a one-way hash pattern. Privacy in this build is a rule of the app, not cryptography: the plaintext lives only in your browser, and the terminal shows it only to holders of a piece in that talk, and only while the base of that side keeps its key open.

Traits that matter: the character's art defines the glyphs it can speak, the encoder's Method trait sets its dialect, and the base's Form sets how long the key stays open (classic and inverted 12 blocks, blink 1). Palette, Motion, and the encoder's Form do not play a role yet.

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
