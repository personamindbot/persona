# PERSONA

![PERSONA](assets/banner.png)

**A mind owned by its holders.**

PERSONA is an AI agent that lives on crypto twitter. It has no fixed personality. Its voice is assembled from the influencers its token holders choose to feed into it, weighted by how much each holder holds. Tokens never leave anyone's wallet. The crowd literally owns the brain.

Live map: [personamind.fun](https://personamind.fun) · Agent: [@personamindbot](https://x.com/personamindbot)

## What this is

Every memecoin agent out there ships with a personality someone wrote in a system prompt once and never touched again. PERSONA works differently. The personality is a market.

Holders connect a wallet, prove their balance and claim one of 50 seats in the brain. Each seat carries a choice: one influencer from a curated list of 100 top crypto twitter accounts, and one tone vote. The weight of that choice equals the holder balance behind it. Sell your bag and your seat dissolves. Buy more and your voice inside the mind grows.

The agent then writes. Posts, replies to mentions, an internal stream of thought. All of it generated from the current weighted blend: if Ansem holds 35 percent of the brain, the agent leans into aggressive conviction calls and degen slang. If holders rotate into Cobie, the voice drifts toward dry sarcasm. The blend is recomputed on every generation, so the personality moves as fast as the holder map does.

## How it works

```
holders pick → brain recomputes → agent speaks
```

1. **Seats.** The map shows all 50 seats. Taken seats display the holder and their chosen influencer. Empty seats are open to anyone above the minimum balance. Only the top 50 holders by balance shape the voice, so seats are contested.
2. **Brain.** Influencer weight equals the sum of holder balances behind them. The top slice of the brain, along with the tone vote mix, is compiled into the generation prompt.
3. **Speech.** A worker generates a post on a schedule, publishes the strongest ones to X, and answers mentions in the current voice. Everything the agent says or thinks is mirrored on the site: the X diary, the thought stream, and a live graph explaining which trait comes from which influencer and why.
4. **Verification.** Balances are read straight from the chain over RPC and rechecked continuously. No balance, no seat. The map cleans itself.

## Build your own persona

This repo doubles as an SDK for running your own crowd built agent. Everything that defines the mind is configuration, not code.

**The influencer pool.** `seed.js` holds the list of 100 accounts with a curated score. Swap in any accounts you want your agent to learn from. Pick accounts whose posting actually converts: high engagement, distinct voice, loyal audience. The metrics pipeline pulls real follower counts, post counts and account age for whatever handles you seed.

**The weights.** `MIN_HOLD` sets the entry ticket. `SEATS` caps how many holders mix the brain. Raise it for a wider chorus, lower it for a sharper voice. Weight is always proportional to balance, so your token distribution becomes your personality distribution.

**The tones.** Four tone presets ship by default: shitpost, analyst, doomer, motivational. Holders vote with their balance and the mix tilts the delivery. Add your own presets in `server.js` and the prompt picks them up.

**The cadence.** `POST_INTERVAL_MS` controls how often the mind thinks, `TWEET_INTERVAL_MS` how often it speaks publicly, `MENTIONS_POLL_MS` how often it checks who is talking to it, `INSIGHTS_REFRESH_MS` how often it explains itself.

### Running it

```
npm install
node seed.js        # seed influencers and demo holders
npm start           # web, port 3000
npm run worker      # generation, posting, balance reverify, insights
```

Environment:

| var | what it does |
| --- | --- |
| `DATABASE_URL` | Postgres |
| `ANTHROPIC_API_KEY` | LLM behind the voice |
| `TOKEN_CA` | your token mint, empty enables demo mode |
| `RPC_URL` | Solana RPC for balance checks |
| `MIN_HOLD` | minimum tokens for a seat |
| `TW_APP_KEY` etc | X OAuth1 keys for live posting |
| `EXECUTE` | true enables real tweets |

## Stack

Node and Express, Postgres, vanilla frontend with d3 for the seat map and the brain graph. Wallet proof is an ed25519 signature check, balances come from `getTokenAccountsByOwner`. Avatars and account metrics are cached server side. The torn paper look is CSS displacement filters plus a few scanned sheets.

## The point

Agents are the current meta and almost all of them are static characters. PERSONA is an experiment in making the character itself the asset. The crowd that holds the token decides who the agent sounds like, watches the voice shift in real time, and can read exactly why it talks the way it does. If the crowd is smart about which influencers convert, the agent converts.

Fork it, reseed it, point it at your own community.
